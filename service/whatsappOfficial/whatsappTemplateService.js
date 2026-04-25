import WhatsappTemplate from "../../models/WhatsappTemplate.js";

export const DEFAULT_TEMPLATE_VARIABLES = [
  "{nome_cliente}",
  "{nome_pet}",
  "{data_agendamento}",
  "{hora_agendamento}",
  "{valor}",
  "{nome_empresa}",
];

const DEFAULT_TEMPLATES = [
  {
    templateName: "confirmacao_horario",
    title: "Confirmacao de horario",
    category: "agenda",
    body: "Oi, {nome_cliente}! Confirmando o horario do {nome_pet} em {data_agendamento} as {hora_agendamento}.",
    sortOrder: 1,
  },
  {
    templateName: "lembrete_banho",
    title: "Lembrete de banho",
    category: "agenda",
    body: "Oi, {nome_cliente}! Passando para lembrar do banho/tosa do {nome_pet} em {data_agendamento} as {hora_agendamento}.",
    sortOrder: 2,
  },
  {
    templateName: "cobranca",
    title: "Cobranca",
    category: "financeiro",
    body: "Oi, {nome_cliente}! Ficou pendente o valor de {valor}. Se precisar, posso te enviar os detalhes agora.",
    sortOrder: 3,
  },
  {
    templateName: "retorno_cliente_antigo",
    title: "Retorno de cliente antigo",
    category: "relacionamento",
    body: "Oi, {nome_cliente}! Faz um tempo que nao vemos o {nome_pet} por aqui. Quer que eu veja um horario para voce?",
    sortOrder: 4,
  },
  {
    templateName: "aviso_pacote",
    title: "Aviso de pacote",
    category: "pacotes",
    body: "Oi, {nome_cliente}! O pacote do {nome_pet} esta com movimentacao nova. Se quiser, te explico certinho por aqui.",
    sortOrder: 5,
  },
  {
    templateName: "pos_atendimento",
    title: "Pos-atendimento",
    category: "relacionamento",
    body: "Oi, {nome_cliente}! Obrigado pela confianca no atendimento do {nome_pet}. Qualquer coisa, estou por aqui.",
    sortOrder: 6,
  },
];

function normalizeTemplatePayload(payload = {}) {
  const templateName = String(payload.templateName || payload.name || "").trim();
  const status = String(payload.status || "").trim() || (payload.active === false ? "inactive" : "active");
  return {
    templateName,
    title: String(payload.title || payload.label || templateName || "").trim() || null,
    language: String(payload.language || "pt_BR").trim() || "pt_BR",
    category: payload.category !== undefined ? String(payload.category || "").trim() || null : null,
    status,
    active: payload.active !== undefined ? Boolean(payload.active) : status !== "inactive",
    isSystem: Boolean(payload.isSystem),
    sortOrder: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
    body: payload.body !== undefined ? String(payload.body || "") : "",
    variables: Array.isArray(payload.variables) ? payload.variables.filter(Boolean) : DEFAULT_TEMPLATE_VARIABLES,
    components: payload.components && typeof payload.components === "object" ? payload.components : {},
  };
}

export async function ensureDefaultTemplates(companyId) {
  for (const template of DEFAULT_TEMPLATES) {
    await upsertTemplate(companyId, {
      ...template,
      language: "pt_BR",
      active: true,
      isSystem: true,
      variables: DEFAULT_TEMPLATE_VARIABLES,
    });
  }
}

export async function listTemplates(companyId) {
  await ensureDefaultTemplates(companyId);
  return WhatsappTemplate.findAll({
    where: { companyId },
    order: [
      ["sortOrder", "ASC"],
      ["updatedAt", "DESC"],
    ],
  });
}

export async function upsertTemplate(companyId, payload = {}) {
  const normalized = normalizeTemplatePayload(payload);
  if (!normalized.templateName) throw new Error("template_name obrigatorio");

  const [template] = await WhatsappTemplate.findOrCreate({
    where: {
      companyId,
      templateName: normalized.templateName,
    },
    defaults: {
      companyId,
      usersId: companyId,
      ...normalized,
    },
  });

  await template.update({
    title: normalized.title,
    language: normalized.language,
    category: normalized.category,
    status: normalized.status,
    active: normalized.active,
    isSystem: normalized.isSystem !== undefined ? normalized.isSystem : template.isSystem,
    sortOrder: normalized.sortOrder,
    body: normalized.body,
    variables: normalized.variables,
    components: normalized.components,
  });

  return template;
}

export async function deleteTemplate(companyId, templateId) {
  const row = await WhatsappTemplate.findOne({
    where: {
      id: templateId,
      companyId,
    },
  });

  if (!row) {
    throw new Error("Template nao encontrado");
  }

  await row.destroy();
  return true;
}
