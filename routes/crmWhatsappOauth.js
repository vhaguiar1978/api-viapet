import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import authenticate from "../middlewares/auth.js";
import Settings from "../models/Settings.js";

const router = express.Router();
const OAUTH_SCOPE =
  "whatsapp_business_management,whatsapp_business_messaging";

function getJwtSecret() {
  return readFirstValidEnv([
    "JWT_SECRET",
    "JWTSECRET",
    "JWT_SECRET_KEY",
  ]) || "viapet_jwt_fallback_change_me";
}

const FRONTEND_URL = String(
  process.env.FRONTEND_URL || "https://app.viapet.app",
).replace(/\/+$/, "");
const WHATSAPP_MESSAGES_URL = `${FRONTEND_URL}/mensagens`;

function getMetaAppId() {
  return readFirstValidEnv([
    "META_APP_ID",
    "METAAPP_ID",
    "METAAPPID",
    "META_APPID",
    "META_APP_ID_ALT",
  ]);
}

function getMetaAppSecret() {
  return readFirstValidEnv([
    "META_APP_SECRET",
    "METAAPP_SECRET",
    "METAAPPSECRET",
    "META_SECRET",
    "META_APP_SECRET_ALT",
  ]);
}

function getCallbackUri() {
  const apiUrl = String(
    process.env.URL || process.env.API_URL || "http://localhost:4003",
  ).trim();
  return `${apiUrl.replace(/\/+$/, "")}/crm-whatsapp/oauth/callback`;
}

function readFirstValidEnv(keys = []) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim().replace(/^['"]+|['"]+$/g, "");
    if (normalized) return normalized;
  }
  return "";
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

function getOauthErrorPresentation(reason = "") {
  const normalizedReason = String(reason || "").trim().toLowerCase();

  switch (normalizedReason) {
    case "no_phone_numbers":
      return {
        message: "Nenhum numero de WhatsApp Business foi encontrado.",
        details:
          "Confirme se o usuario tem um numero ativo na Meta e permissao para acessar a conta do WhatsApp Business.",
      };
    case "exchange_failed":
      return {
        message: "A Meta nao concluiu a conexao do WhatsApp.",
        details:
          "Revise as permissoes whatsapp_business_management e whatsapp_business_messaging.",
      };
    case "meta_env_missing":
      return {
        message: "A conexao da Meta nao esta configurada no servidor.",
        details:
          "Cadastre META_APP_ID e META_APP_SECRET no ambiente da API antes de tentar novamente.",
      };
    case "invalid_state":
      return {
        message: "A sessao de conexao expirou.",
        details:
          "Abra a integracao novamente no ViaPet e refaca a conexao com a Meta.",
      };
    case "missing_params":
      return {
        message: "A Meta nao devolveu os dados da conexao.",
        details: "Refaca a conexao pelo botao da Meta para gerar um novo retorno.",
      };
    case "cancelled":
      return {
        message: "A conexao com a Meta foi cancelada.",
        details:
          "Se quiser continuar, abra a integracao novamente e conclua todas as etapas.",
      };
    default:
      return {
        message: "Erro ao conectar. Tente novamente.",
        details:
          "Se o erro continuar, revise as permissoes e o numero configurado na Meta.",
      };
  }
}

function oauthResultPage(status, extra = {}) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const reason = String(extra?.reason || "").trim().toLowerCase();
  const payload = JSON.stringify({
    type: "whatsapp_oauth",
    status: normalizedStatus,
    ...extra,
  });
  const fallbackParams = new URLSearchParams({
    waoauth: normalizedStatus,
  });

  if (reason) {
    fallbackParams.set("waoauth_reason", reason);
  }

  const fallbackTarget = `${WHATSAPP_MESSAGES_URL}?${fallbackParams.toString()}`;
  const fallbackTargetJs = JSON.stringify(fallbackTarget);
  const icon =
    normalizedStatus === "connected"
      ? "OK"
      : normalizedStatus === "select"
        ? "..."
        : "X";
  const errorPresentation = getOauthErrorPresentation(reason);
  const message =
    normalizedStatus === "connected"
      ? "WhatsApp conectado com sucesso!"
      : normalizedStatus === "select"
        ? "Selecione o numero no ViaPet."
        : errorPresentation.message;
  const subtitle =
    normalizedStatus === "connected"
      ? "Voce sera redirecionado automaticamente para o ViaPet."
      : normalizedStatus === "select"
        ? "Abra o ViaPet para escolher qual numero deseja usar no CRM."
        : errorPresentation.details;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>WhatsApp - ViaPet</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex;
           align-items: center; justify-content: center; height: 100vh; margin: 0;
           background: #f4f4f5; }
    .card { text-align: center; padding: 40px 48px; background: #fff;
            border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.08); max-width: 520px; }
    .icon { font-size: 40px; margin-bottom: 12px; color: #111; font-weight: 700; }
    p { margin: 0 0 8px; font-size: 16px; color: #111; font-weight: 500; }
    small { color: #666; font-size: 13px; line-height: 1.5; display: block; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <p>${message}</p>
    <small>${subtitle}</small>
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
    } catch (error) {
      window.location.replace(${fallbackTargetJs});
    }
  </script>
</body>
</html>`;
}

router.get("/crm-whatsapp/oauth/url", authenticate, (req, res) => {
  const metaAppId = getMetaAppId();
  const callbackUri = getCallbackUri();

  if (!metaAppId) {
    return res.status(200).json({
      oauthAvailable: false,
      message:
        "A integracao OAuth com a Meta ainda nao esta ativada neste servidor. " +
        "Configure as variaveis META_APP_ID e META_APP_SECRET.",
    });
  }

  const state = jwt.sign(
    { eid: getEstablishmentId(req), t: "waoauth" },
    getJwtSecret(),
    { expiresIn: "15m" },
  );

  const params = new URLSearchParams({
    client_id: metaAppId,
    redirect_uri: callbackUri,
    scope: OAUTH_SCOPE,
    state,
    response_type: "code",
  });

  return res.json({
    url: `https://www.facebook.com/dialog/oauth?${params.toString()}`,
  });
});

router.get("/crm-whatsapp/oauth/callback", async (req, res) => {
  const metaAppId = getMetaAppId();
  const metaAppSecret = getMetaAppSecret();
  const callbackUri = getCallbackUri();
  const { code, state, error } = req.query;

  if (error) {
    return res.send(oauthResultPage("cancelled", { reason: "cancelled" }));
  }

  if (!code || !state) {
    return res.send(oauthResultPage("error", { reason: "missing_params" }));
  }

  let establishmentId;
  try {
    const decoded = jwt.verify(state, getJwtSecret());
    if (decoded.t !== "waoauth") {
      throw new Error("Tipo de state invalido");
    }
    establishmentId = decoded.eid;
  } catch {
    return res.send(oauthResultPage("error", { reason: "invalid_state" }));
  }

  try {
    if (!metaAppId || !metaAppSecret) {
      return res.send(oauthResultPage("error", { reason: "meta_env_missing" }));
    }

    const tokenRes = await axios.get(
      "https://graph.facebook.com/oauth/access_token",
      {
        params: {
          client_id: metaAppId,
          client_secret: metaAppSecret,
          redirect_uri: callbackUri,
          code,
        },
      },
    );
    const accessToken = tokenRes.data.access_token;
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
      const { phoneNumberId, businessAccountId } = phoneNumbers[0];
      settings.whatsappConnection = buildConnectedConfig(
        settings.whatsappConnection,
        { phoneNumberId, businessAccountId, accessToken },
      );
      await settings.save();
      return res.send(oauthResultPage("connected"));
    }

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

router.get("/crm-whatsapp/oauth/pending-phones", authenticate, async (req, res) => {
  try {
    const { settings } = await resolveSettingsOwner(req);
    const phones = settings?.whatsappConnection?.pendingOauthPhones || [];
    return res.json({ data: phones });
  } catch (err) {
    return res.status(500).json({ message: "Erro no servidor", error: err.message });
  }
});

router.post("/crm-whatsapp/oauth/select-phone", authenticate, async (req, res) => {
  try {
    const { phoneNumberId } = req.body || {};
    const { settings } = await resolveSettingsOwner(req);
    if (!settings) {
      return res.status(404).json({ message: "Configuracoes nao encontradas" });
    }

    const phones = settings.whatsappConnection?.pendingOauthPhones || [];
    const selected = phones.find((phone) => phone.phoneNumberId === phoneNumberId);
    if (!selected) {
      return res.status(400).json({ message: "Numero nao encontrado na lista pendente" });
    }

    const accessToken = settings.whatsappConnection?.pendingOauthToken || "";
    settings.whatsappConnection = buildConnectedConfig(
      settings.whatsappConnection,
      {
        phoneNumberId: selected.phoneNumberId,
        businessAccountId: selected.businessAccountId,
        accessToken,
      },
    );
    await settings.save();

    return res.json({
      message: "Numero conectado com sucesso",
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

router.delete("/crm-whatsapp/oauth/disconnect", authenticate, async (req, res) => {
  try {
    const { settings } = await resolveSettingsOwner(req);
    if (!settings) {
      return res.status(404).json({ message: "Configuracoes nao encontradas" });
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
  const errors = [];

  try {
    const bizRes = await axios.get("https://graph.facebook.com/v21.0/me/businesses", {
      params: {
        access_token: accessToken,
        fields: "id,name",
      },
    });

    for (const biz of bizRes.data.data || []) {
      try {
        const wabaRes = await axios.get(
          `https://graph.facebook.com/v21.0/${biz.id}/owned_whatsapp_business_accounts`,
          {
            params: {
              access_token: accessToken,
              fields: "id,name",
            },
          },
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

            for (const phone of phonesRes.data.data || []) {
              phoneNumbers.push({
                phoneNumberId: phone.id,
                displayPhone: phone.display_phone_number,
                verifiedName: phone.verified_name || "",
                qualityRating: phone.quality_rating || "UNKNOWN",
                businessAccountId: waba.id,
                businessName: waba.name || biz.name || "",
              });
            }
          } catch (error) {
            errors.push(error.response?.data || error.message);
          }
        }
      } catch (error) {
        errors.push(error.response?.data || error.message);
      }
    }
  } catch (error) {
    errors.push(error.response?.data || error.message);
  }

  if (phoneNumbers.length > 0) {
    return phoneNumbers;
  }

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
      for (const phone of waba.phone_numbers?.data || []) {
        phoneNumbers.push({
          phoneNumberId: phone.id,
          displayPhone: phone.display_phone_number,
          verifiedName: phone.verified_name || "",
          qualityRating: phone.quality_rating || "UNKNOWN",
          businessAccountId: waba.id,
          businessName: waba.name || "",
        });
      }
    }
  } catch (error) {
    errors.push(error.response?.data || error.message);
  }

  if (phoneNumbers.length === 0 && errors.length > 0) {
    console.error("[OAUTH] Nenhum numero retornado pela Meta:", errors);
  }

  return phoneNumbers;
}

export default router;
