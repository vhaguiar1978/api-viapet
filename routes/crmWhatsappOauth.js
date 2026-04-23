import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import authenticate from "../middlewares/auth.js";
import Settings from "../models/Settings.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "secret";
const FRONTEND_URL = String(process.env.FRONTEND_URL || "https://app.viapet.app").replace(/\/+$/, "");
const WHATSAPP_MESSAGES_URL = `${FRONTEND_URL}/mensagens`;

function getMetaAppId() {
  return String(
    process.env.META_APP_ID ||
      process.env.METAAPP_ID ||
      process.env.META_APPID ||
      "",
  ).trim();
}

function getMetaAppSecret() {
  return String(
    process.env.META_APP_SECRET ||
      process.env.METAAPP_SECRET ||
      process.env.META_SECRET ||
      "",
  ).trim();
}

function getCallbackUri() {
  const apiUrl = String(process.env.URL || process.env.API_URL || "http://localhost:4003").trim();
  return `${apiUrl.replace(/\/+$/, "")}/crm-whatsapp/oauth/callback`;
}

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
}

function getCandidateUserIds(req) {
  return [req.user?.establishment, req.user?.id]
    .map((value) => String(value || "").trim())
    .filter((value, index, array) => value && array.indexOf(value) === index);
}

async function resolveSettingsOwner(req) {
  const candidateIds = getCandidateUserIds(req);

  for (const candidateId of candidateIds) {
    const settings = await Settings.findOne({ where: { usersId: candidateId } });
    if (settings) {
      return { userId: candidateId, settings };
    }
  }

  const preferredId = getEstablishmentId(req);
  if (!preferredId) {
    throw new Error("Estabelecimento nao identificado");
  }

  const settings = await Settings.create({
    usersId: preferredId,
    whatsappConnection: {},
  });

  return { userId: preferredId, settings };
}

// Página HTML retornada ao popup após o OAuth
function oauthResultPage(status, extra = {}) {
  const payload = JSON.stringify({ type: "whatsapp_oauth", status, ...extra });
  const fallbackTarget = `${WHATSAPP_MESSAGES_URL}?waoauth=${encodeURIComponent(status)}`;
  const fallbackTargetJs = JSON.stringify(fallbackTarget);
  const icon = status === "connected" ? "✅" : status === "select" ? "📱" : "❌";
  const msg =
    status === "connected"
      ? "WhatsApp conectado com sucesso!"
      : status === "select"
      ? "Selecione o número no ViaPet."
      : "Erro ao conectar. Tente novamente.";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>WhatsApp — ViaPet</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex;
           align-items: center; justify-content: center; height: 100vh; margin: 0;
           background: #f4f4f5; }
    .card { text-align: center; padding: 40px 48px; background: #fff;
            border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .icon { font-size: 40px; margin-bottom: 12px; }
    p { margin: 0 0 8px; font-size: 16px; color: #111; font-weight: 500; }
    small { color: #888; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <p>${msg}</p>
    <small>Voce sera redirecionado automaticamente para o ViaPet.</small>
    <p style="margin-top:14px;">
      <a href="${fallbackTarget}" style="color:#4f46e5;text-decoration:none;font-weight:600;">
        Voltar para Mensagens
      </a>
    </p>
  </div>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(${payload}, "*");
        setTimeout(() => window.close(), 1200);
      } else {
        window.location.replace(${fallbackTargetJs});
      }
    } catch(e) {
      window.location.replace(${fallbackTargetJs});
    }
  </script>
</body>
</html>`;
}

// ─── GET /crm-whatsapp/oauth/url ─────────────────────────────────────────────
// Retorna a URL do OAuth da Meta para o frontend abrir em popup
router.get("/crm-whatsapp/oauth/url", authenticate, (req, res) => {
  const metaAppId = getMetaAppId();
  const callbackUri = getCallbackUri();

  if (!metaAppId) {
    return res.status(503).json({
      message:
        "A integração OAuth com a Meta ainda não está ativada neste servidor. " +
        "Configure a variável META_APP_ID.",
    });
  }

  const state = jwt.sign(
    { eid: getEstablishmentId(req), t: "waoauth" },
    JWT_SECRET,
    { expiresIn: "15m" },
  );

  const params = new URLSearchParams({
    client_id: metaAppId,
    redirect_uri: callbackUri,
    scope: "whatsapp_business_management,whatsapp_business_messaging",
    state,
    response_type: "code",
  });

  return res.json({ url: `https://www.facebook.com/dialog/oauth?${params.toString()}` });
});

// ─── GET /crm-whatsapp/oauth/callback ────────────────────────────────────────
// Meta redireciona aqui após o login do usuário (rota pública)
router.get("/crm-whatsapp/oauth/callback", async (req, res) => {
  const metaAppId = getMetaAppId();
  const metaAppSecret = getMetaAppSecret();
  const callbackUri = getCallbackUri();
  const { code, state, error } = req.query;

  if (error) {
    return res.send(oauthResultPage("cancelled"));
  }

  if (!code || !state) {
    return res.send(oauthResultPage("error", { reason: "missing_params" }));
  }

  let establishmentId;
  try {
    const decoded = jwt.verify(state, JWT_SECRET);
    if (decoded.t !== "waoauth") throw new Error("type inválido");
    establishmentId = decoded.eid;
  } catch {
    return res.send(oauthResultPage("error", { reason: "invalid_state" }));
  }

  try {
    // 1. Troca code → access token
    if (!metaAppId || !metaAppSecret) {
      return res.send(oauthResultPage("error", { reason: "meta_env_missing" }));
    }

    const tokenRes = await axios.get("https://graph.facebook.com/oauth/access_token", {
      params: {
        client_id: metaAppId,
        client_secret: metaAppSecret,
        redirect_uri: callbackUri,
        code,
      },
    });
    const accessToken = tokenRes.data.access_token;

    // 2. Coleta todos os números de telefone disponíveis nas WABAs do usuário
    const phoneNumbers = await collectPhoneNumbers(accessToken);

    if (phoneNumbers.length === 0) {
      return res.send(oauthResultPage("error", { reason: "no_phone_numbers" }));
    }

    let settings = await Settings.findOne({ where: { usersId: establishmentId } });
    if (!settings) {
      settings = await Settings.create({
        usersId: establishmentId,
        whatsappConnection: {},
      });
    }

    if (phoneNumbers.length === 1) {
      // Um único número → conecta diretamente
      const { phoneNumberId, businessAccountId } = phoneNumbers[0];
      settings.whatsappConnection = buildConnectedConfig(
        settings.whatsappConnection,
        { phoneNumberId, businessAccountId, accessToken },
      );
      await settings.save();
      return res.send(oauthResultPage("connected"));
    }

    // Múltiplos números → armazena para o usuário escolher
    settings.whatsappConnection = {
      ...(settings.whatsappConnection || {}),
      pendingOauthToken: accessToken,
      pendingOauthPhones: phoneNumbers,
    };
    await settings.save();
    return res.send(oauthResultPage("select"));
  } catch (err) {
    console.error("[OAUTH] Erro no callback:", err.response?.data || err.message);
    return res.send(oauthResultPage("error", { reason: "exchange_failed" }));
  }
});

// ─── GET /crm-whatsapp/oauth/pending-phones ──────────────────────────────────
// Retorna a lista de números pendentes de seleção
router.get("/crm-whatsapp/oauth/pending-phones", authenticate, async (req, res) => {
  try {
    const { settings } = await resolveSettingsOwner(req);
    const phones = settings?.whatsappConnection?.pendingOauthPhones || [];
    return res.json({ data: phones });
  } catch (err) {
    return res.status(500).json({ message: "Erro no servidor", error: err.message });
  }
});

// ─── POST /crm-whatsapp/oauth/select-phone ───────────────────────────────────
// Usuário escolhe qual número usar quando há múltiplos disponíveis
router.post("/crm-whatsapp/oauth/select-phone", authenticate, async (req, res) => {
  try {
    const { phoneNumberId } = req.body || {};
    const { settings } = await resolveSettingsOwner(req);
    if (!settings) {
      return res.status(404).json({ message: "Configurações não encontradas" });
    }

    const phones = settings.whatsappConnection?.pendingOauthPhones || [];
    const selected = phones.find((p) => p.phoneNumberId === phoneNumberId);
    if (!selected) {
      return res.status(400).json({ message: "Número não encontrado na lista pendente" });
    }

    const accessToken = settings.whatsappConnection?.pendingOauthToken || "";
    settings.whatsappConnection = buildConnectedConfig(
      settings.whatsappConnection,
      { phoneNumberId: selected.phoneNumberId, businessAccountId: selected.businessAccountId, accessToken },
    );
    await settings.save();

    return res.json({
      message: "Número conectado com sucesso",
      data: {
        phoneNumberId: selected.phoneNumberId,
        displayPhone: selected.displayPhone,
        verifiedName: selected.verifiedName,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Erro no servidor", error: err.message });
  }
});

// ─── DELETE /crm-whatsapp/oauth/disconnect ───────────────────────────────────
// Desconecta o WhatsApp do estabelecimento
router.delete("/crm-whatsapp/oauth/disconnect", authenticate, async (req, res) => {
  try {
    const { settings } = await resolveSettingsOwner(req);
    if (!settings) {
      return res.status(404).json({ message: "Configurações não encontradas" });
    }

    settings.whatsappConnection = {
      ...(settings.whatsappConnection || {}),
      phoneNumberId: "",
      businessAccountId: "",
      accessToken: "",
      accessTokenConfigured: false,
      oauthConnectedAt: null,
      pendingOauthToken: null,
      pendingOauthPhones: null,
    };
    await settings.save();

    return res.json({ message: "WhatsApp desconectado com sucesso" });
  } catch (err) {
    return res.status(500).json({ message: "Erro no servidor", error: err.message });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildConnectedConfig(current = {}, { phoneNumberId, businessAccountId, accessToken }) {
  return {
    ...current,
    provider: "WhatsApp Cloud API",
    phoneNumberId,
    businessAccountId,
    accessToken,
    accessTokenConfigured: true,
    verifyToken: current.verifyToken || "genius",
    defaultCountryCode: current.defaultCountryCode || "55",
    oauthConnectedAt: new Date().toISOString(),
    pendingOauthToken: null,
    pendingOauthPhones: null,
  };
}

async function collectPhoneNumbers(accessToken) {
  const phoneNumbers = [];

  // Tentativa 1: via /me/businesses → WABAs → phone_numbers
  try {
    const bizRes = await axios.get("https://graph.facebook.com/v21.0/me/businesses", {
      params: { access_token: accessToken, fields: "id,name" },
    });
    for (const biz of bizRes.data.data || []) {
      try {
        const wabaRes = await axios.get(
          `https://graph.facebook.com/v21.0/${biz.id}/owned_whatsapp_business_accounts`,
          { params: { access_token: accessToken, fields: "id,name" } },
        );
        for (const waba of wabaRes.data.data || []) {
          try {
            const phonesRes = await axios.get(
              `https://graph.facebook.com/v21.0/${waba.id}/phone_numbers`,
              {
                params: {
                  access_token: accessToken,
                  fields: "id,display_phone_number,verified_name,quality_rating",
                },
              },
            );
            for (const p of phonesRes.data.data || []) {
              phoneNumbers.push({
                phoneNumberId: p.id,
                displayPhone: p.display_phone_number,
                verifiedName: p.verified_name || "",
                qualityRating: p.quality_rating || "UNKNOWN",
                businessAccountId: waba.id,
                businessName: waba.name || biz.name || "",
              });
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}

  if (phoneNumbers.length > 0) return phoneNumbers;

  // Tentativa 2 (fallback): via /me/whatsapp_business_accounts com phone_numbers embutidos
  try {
    const directRes = await axios.get(
      "https://graph.facebook.com/v21.0/me/whatsapp_business_accounts",
      {
        params: {
          access_token: accessToken,
          fields:
            "id,name,phone_numbers{id,display_phone_number,verified_name,quality_rating}",
        },
      },
    );
    for (const waba of directRes.data.data || []) {
      for (const p of waba.phone_numbers?.data || []) {
        phoneNumbers.push({
          phoneNumberId: p.id,
          displayPhone: p.display_phone_number,
          verifiedName: p.verified_name || "",
          qualityRating: p.quality_rating || "UNKNOWN",
          businessAccountId: waba.id,
          businessName: waba.name || "",
        });
      }
    }
  } catch {}

  return phoneNumbers;
}

export default router;
