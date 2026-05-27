import axios from "axios";
import Admin from "../models/Admin.js";
import { normalizePhone } from "./whatsappOfficial/phone.js";

const DEFAULT_TEMPLATE =
  "Ola, {name}! Seja muito bem-vindo(a) ao ViaPet. Sua conta foi criada com sucesso. Se precisar de ajuda para começar, fale com a nossa equipe por aqui.";

function buildApiBase(phoneNumberId) {
  return `https://graph.facebook.com/v21.0/${phoneNumberId}`;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function fillTemplate(template, vars = {}) {
  let body = String(template || "");
  for (const [key, value] of Object.entries(vars)) {
    body = body.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return body.trim();
}

export async function sendSystemWelcomeWhatsapp({ name, phone }) {
  const destination = normalizePhone(phone);
  if (!destination) {
    return { skipped: "no_phone" };
  }

  const settings = await Admin.findOne();
  if (!settings || settings.whatsappWelcomeEnabled !== true) {
    return { skipped: "disabled" };
  }

  const accessToken =
    String(process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "").trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  if (!accessToken || !phoneNumberId) {
    return { skipped: "not_configured" };
  }

  const body = fillTemplate(settings?.whatsappWelcomeTemplate || DEFAULT_TEMPLATE, {
    name: String(name || "").trim() || "Cliente",
    phone: destination,
    consultantWhatsapp: settings?.siteConsultantWhatsapp || "",
  });

  if (!body) {
    return { skipped: "empty_template" };
  }

  await axios.post(
    `${buildApiBase(phoneNumberId)}/messages`,
    {
      messaging_product: "whatsapp",
      to: destination,
      type: "text",
      text: { body },
    },
    { headers: authHeaders(accessToken) },
  );

  return { sent: true, phone: destination };
}
