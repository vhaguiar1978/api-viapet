import WhatsappTemplate from "../../models/WhatsappTemplate.js";

export async function listTemplates(companyId) {
  return WhatsappTemplate.findAll({
    where: { companyId },
    order: [["updatedAt", "DESC"]],
  });
}

export async function upsertTemplate(companyId, payload = {}) {
  const templateName = String(payload.templateName || payload.name || "").trim();
  if (!templateName) throw new Error("template_name obrigatorio");

  const [template] = await WhatsappTemplate.findOrCreate({
    where: {
      companyId,
      templateName,
    },
    defaults: {
      companyId,
      usersId: companyId,
      templateName,
      language: payload.language || "pt_BR",
      category: payload.category || null,
      status: payload.status || "active",
      components: payload.components || {},
    },
  });

  await template.update({
    language: payload.language || template.language || "pt_BR",
    category:
      payload.category !== undefined ? payload.category : template.category,
    status: payload.status || template.status || "active",
    components:
      payload.components !== undefined
        ? payload.components || {}
        : template.components || {},
  });

  return template;
}
