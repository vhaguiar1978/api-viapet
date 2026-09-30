import { Op } from "sequelize";
import Users from "../models/Users.js";
import RelationshipContactApproval from "../models/RelationshipContactApproval.js";
import RelationshipRadarSetting from "../models/RelationshipRadarSetting.js";
import WhatsappIaConversation from "../models/WhatsappIaConversation.js";
import InactiveUserAutomation from "../models/InactiveUserAutomation.js";
import { RADAR_DEFAULTS, checkRelationshipApproval } from "./relationshipRadarRules.js";
import { assessRelationshipUsers } from "./relationshipRadarData.js";
import { sendTemplateMessage } from "./whatsappOfficial/whatsappSendService.js";
import { getConnectionByCompany } from "./whatsappOfficial/whatsappConnectionService.js";
import { logActivity } from "./activityLogger.js";
import sequelize from "../database/config.js";

function saoPauloDayStart(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00-03:00`);
}

export async function approveRelationshipContact({ approvalId, adminUserId, req }) {
  const approval = await RelationshipContactApproval.findOne({ where: { id: approvalId, systemId: "VIAPET" } });
  if (!approval) throw Object.assign(new Error("Contato pendente não encontrado."), { status: 404 });
  if (approval.status !== "pending") throw Object.assign(new Error("Este contato já foi revisado."), { status: 409 });
  const user = await Users.findOne({ where: { id: approval.userId, role: "proprietario", status: true }, attributes: ["id", "establishment", "name", "companyName", "phone", "createdAt", "lastAccess", "plan"] });
  if (!user) throw Object.assign(new Error("Cliente indisponível."), { status: 404 });
  const row = await RelationshipRadarSetting.findOne({ where: { systemId: "VIAPET" } });
  const settings = { ...RADAR_DEFAULTS, ...(row?.settings || {}) };
  const [decision] = await assessRelationshipUsers([user], settings);
  const organizationId = user.establishment || user.id;
  const [conversation, automation] = await Promise.all([
    WhatsappIaConversation.findOne({ where: { organizationId, userId: user.id } }),
    InactiveUserAutomation.findOne({ where: { organizationId, userId: user.id } }),
  ]);
  const senderCompanyId = String(process.env.VIAPET_WHATSAPP_COMPANY_ID || "").trim();
  const templateName = String(process.env.VIAPET_WHATSAPP_REACTIVATION_TEMPLATE || "").trim();
  const connection = senderCompanyId ? await getConnectionByCompany(senderCompanyId) : null;
  const senderReady = Boolean(senderCompanyId && templateName && user.phone && connection?.connection?.phoneNumberId && connection?.accessToken);
  await sequelize.transaction(async (transaction) => {
    const lockedSettings = await RelationshipRadarSetting.findOne({ where: { systemId: "VIAPET" }, lock: transaction.LOCK.UPDATE, transaction });
    if (!lockedSettings) throw Object.assign(new Error("Regras do Radar não encontradas."), { status: 409 });
    const currentSettings = { ...RADAR_DEFAULTS, ...(lockedSettings.settings || {}) };
    const inFlightToday = await RelationshipContactApproval.count({ where: { systemId: "VIAPET", status: { [Op.in]: ["processing", "sent"] }, reviewedAt: { [Op.gte]: saoPauloDayStart(new Date()) } }, transaction });
    const lastContact = await RelationshipContactApproval.findOne({ where: { systemId: "VIAPET", userId: user.id, status: { [Op.in]: ["processing", "sent"] } }, order: [["reviewedAt", "DESC"]], transaction });
    const lastContactAt = [conversation?.lastAiMessageAt, automation?.lastContactAt, lastContact?.reviewedAt].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
    const reason = checkRelationshipApproval({ decision, settings: currentSettings, sentToday: inFlightToday, lastContactAt, attempts: automation?.attempts || 0, senderReady });
    if (reason) throw Object.assign(new Error(`Contato bloqueado: ${reason}.`), { status: 409, reason });
    const [claimed] = await RelationshipContactApproval.update({ status: "processing", reviewedBy: adminUserId, reviewedAt: new Date() }, { where: { id: approval.id, status: "pending" }, transaction });
    if (claimed !== 1) throw Object.assign(new Error("Este contato já está em processamento."), { status: 409 });
  });
  try {
    const sent = await sendTemplateMessage({ companyId: senderCompanyId, to: user.phone, templateName });
    await approval.update({ status: "sent", providerMessageId: sent.metaMessageId || null, metadata: { ...(approval.metadata || {}), conversationId: sent.conversationId, templateName } });
    try {
      await logActivity({ req, modulo: "relationship_radar", acao: "approved_contact_sent", descricao: `Contato aprovado e enviado para ${user.companyName || user.name}.`, entidadeTipo: "relationship_contact_approval", entidadeId: approval.id, metadata: { userId: user.id, action: decision.nextAction, reason: decision.reason, metaMessageId: sent.metaMessageId } });
    } catch (auditError) {
      console.error("[relationship-radar] falha ao registrar auditoria do contato", auditError?.message);
    }
    return approval;
  } catch (error) {
    await approval.update({ status: "failed", errorCode: "send_uncertain", metadata: { ...(approval.metadata || {}), error: String(error?.message || error).slice(0, 300) } });
    throw Object.assign(new Error("Falha ou resultado incerto no envio. Não tente novamente sem verificar o histórico do WhatsApp."), { status: 502 });
  }
}
