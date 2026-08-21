import express from "express";
import auth from "../middlewares/auth.js";
import AiSettings from "../models/AiSettings.js";
import Settings from "../models/Settings.js";
import { CRM_AI_OPERATIONAL_ACTIONS, executeCrmAiOperationalAction } from "../service/crmAiOperationalActions.js";
import { listAiPermissions, saveAiPermissions } from "../service/aiPermissionService.js";
import AiCalendarApproval from "../models/AiCalendarApproval.js";
import AiCalendarActionLog from "../models/AiCalendarActionLog.js";
import AiWaitlist from "../models/AiWaitlist.js";
import Appointment from "../models/Appointment.js";
import { Op } from "sequelize";
import { deleteAiEntityRule, getAiCalendarRules, listAiEntityRules, saveAiCalendarRules, saveAiEntityRule } from "../service/aiCalendarRulesService.js";

function canManageAi(req) {
  return ["admin", "proprietario"].includes(String(req.user?.role || "").toLowerCase());
}

const router = express.Router();

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
}

function sanitizeSettingsPayload(body = {}) {
  const allowed = [
    "aiActive",
    "allowAiSchedule",
    "allowAiRegisterNewCustomer",
    "allowAiRegisterPet",
    "allowAiOfferExtraServices",
    "allowAiOfferProducts",
    "allowAiReadPaymentProof",
    "allowAiChargeCustomers",
    "allowAiMonthlyReport",
    "monthlyReportDay",
    "monthlyReportTime",
    "humanTransferPhone",
    "defaultAiTone",
    "settings",
  ];
  return allowed.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});
}

async function buildInheritedOperationalSettings(usersId) {
  const settings = await Settings.findOne({ where: { usersId } });
  const control = settings?.whatsappConnection?.crmAiControl || {};
  const capabilities = control?.capabilities || {};
  const scheduling = control?.scheduling || {};

  return {
    inheritedFromRealMode: true,
    usersId,
    aiActive: control.enabled !== false,
    allowAiSchedule: capabilities.createAppointment === true,
    allowAiRegisterNewCustomer:
      capabilities.createCustomer === true || scheduling.allowNewCustomer === true,
    allowAiRegisterPet:
      capabilities.createPet === true || scheduling.allowNewPet === true,
    allowAiOfferExtraServices: capabilities.quoteServices !== false,
    allowAiOfferProducts: capabilities.quoteProducts !== false,
    allowAiReadPaymentProof: capabilities.viewFinancial === true,
    allowAiChargeCustomers: capabilities.viewFinancial === true,
    allowAiMonthlyReport: capabilities.viewFinancial === true,
    humanTransferPhone: control.humanTransferPhone || "",
    defaultAiTone: control.defaultAiTone || "profissional",
  };
}

router.get("/crm-ai/operational/actions", auth, async (req, res) => {
  res.json({
    success: true,
    data: Object.keys(CRM_AI_OPERATIONAL_ACTIONS),
  });
});

router.get("/crm-ai/operational/settings", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    let settings = await AiSettings.findOne({ where: { usersId } });
    if (!settings) {
      const inherited = await buildInheritedOperationalSettings(usersId);
      return res.json({ success: true, data: inherited });
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error("[CRM AI Operational] settings GET:", error);
    res.status(500).json({
      success: false,
      error: "Nao foi possivel carregar as configuracoes operacionais da IA.",
    });
  }
});

router.put("/crm-ai/operational/settings", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const payload = sanitizeSettingsPayload(req.body || {});
    let settings = await AiSettings.findOne({ where: { usersId } });
    if (!settings) {
      settings = await AiSettings.create({ usersId, ...payload });
    } else {
      await settings.update(payload);
    }
    res.json({
      success: true,
      message: "Configuracoes operacionais da IA salvas com sucesso.",
      data: settings,
    });
  } catch (error) {
    console.error("[CRM AI Operational] settings PUT:", error);
    res.status(500).json({
      success: false,
      error: "Nao foi possivel salvar as configuracoes operacionais da IA.",
    });
  }
});

router.get("/crm-ai/operational/calendar-permissions", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const permissions = await listAiPermissions(usersId);
    res.json({ success: true, data: permissions });
  } catch (error) {
    console.error("[CRM AI Operational] permissions GET:", error);
    res.status(500).json({ success: false, error: "Nao foi possivel carregar as permissoes da agenda." });
  }
});

router.put("/crm-ai/operational/calendar-permissions", auth, async (req, res) => {
  try {
    if (!canManageAi(req)) return res.status(403).json({ success: false, error: "Somente o administrador do estabelecimento pode alterar estas permissoes." });
    const usersId = getEstablishmentId(req);
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    await saveAiPermissions(usersId, permissions);
    res.json({
      success: true,
      message: "Permissoes da agenda salvas com sucesso.",
      data: await listAiPermissions(usersId),
    });
  } catch (error) {
    console.error("[CRM AI Operational] permissions PUT:", error);
    res.status(400).json({ success: false, error: error.message || "Nao foi possivel salvar as permissoes." });
  }
});

router.put("/crm-ai/operational/calendar-automation-pause", auth, async (req, res) => {
  try {
    if (!canManageAi(req)) return res.status(403).json({ success: false, error: "Somente o administrador pode pausar as automacoes." });
    const usersId = getEstablishmentId(req);
    const paused = req.body?.paused === true;
    let settings = await AiSettings.findOne({ where: { usersId } });
    const nextSettings = { ...(settings?.settings || {}), calendarWritesPaused: paused };
    if (!settings) settings = await AiSettings.create({ usersId, settings: nextSettings });
    else await settings.update({ settings: nextSettings });
    res.json({
      success: true,
      message: paused ? "Automacoes da agenda pausadas." : "Automacoes da agenda retomadas.",
      data: { paused },
    });
  } catch (error) {
    console.error("[CRM AI Operational] pause PUT:", error);
    res.status(500).json({ success: false, error: "Nao foi possivel alterar a pausa das automacoes." });
  }
});

router.get("/crm-ai/operational/approvals", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const where = { usersId };
    if (req.query.status) where.status = req.query.status;
    const rows = await AiCalendarApproval.findAll({ where, order: [["requestedAt", "DESC"]], limit: 200 });
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: "Nao foi possivel carregar as aprovacoes." });
  }
});

router.post("/crm-ai/operational/approvals/:approvalId/decision", auth, async (req, res) => {
  try {
    if (!canManageAi(req)) return res.status(403).json({ success: false, error: "Sem permissao para decidir esta solicitacao." });
    const usersId = getEstablishmentId(req);
    const approval = await AiCalendarApproval.findOne({ where: { id: req.params.approvalId, usersId, status: "pending" } });
    if (!approval) return res.status(404).json({ success: false, error: "Solicitacao pendente nao encontrada." });
    const decision = String(req.body?.decision || "");
    if (decision === "reject") {
      await approval.update({ status: "rejected", decidedAt: new Date(), decidedBy: req.user.id, decisionNotes: req.body?.notes || null });
      return res.json({ success: true, data: approval });
    }
    if (decision !== "approve") return res.status(400).json({ success: false, error: "Decisao invalida." });
    const actionByPermission = { appointment_create: "criar_agendamento", appointment_reschedule: "remarcar_agendamento", appointment_cancel: "cancelar_agendamento", appointment_add_service: "adicionar_servico_ao_agendamento" };
    const actionName = actionByPermission[approval.action];
    if (!actionName) return res.status(400).json({ success: false, error: "Esta acao ainda nao possui executor seguro." });
    const result = await executeCrmAiOperationalAction({ usersId, authorUserId: req.user.id }, actionName, { ...(approval.payload || {}), ...(req.body?.payload || {}), humanApproved: true });
    await approval.update({ status: result?.success ? "approved" : "failed", decidedAt: new Date(), decidedBy: req.user.id, decisionNotes: req.body?.notes || result?.error || null, payload: { ...(approval.payload || {}), result } });
    res.status(result?.success ? 200 : 409).json({ success: Boolean(result?.success), data: approval, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Nao foi possivel processar a aprovacao." });
  }
});

router.get("/crm-ai/operational/waitlist", auth, async (req, res) => {
  const usersId = getEstablishmentId(req);
  const rows = await AiWaitlist.findAll({ where: { usersId, ...(req.query.status ? { status: req.query.status } : {}) }, order: [["createdAt", "DESC"]] });
  res.json({ success: true, data: rows });
});

router.get("/crm-ai/operational/calendar-rules", auth, async (req,res)=>{try{res.json({success:true,data:await getAiCalendarRules(getEstablishmentId(req))})}catch(error){res.status(500).json({success:false,error:error.message})}});
router.put("/crm-ai/operational/calendar-rules", auth, async (req,res)=>{try{if(!canManageAi(req))return res.status(403).json({success:false,error:"Sem permissao."});res.json({success:true,data:await saveAiCalendarRules(getEstablishmentId(req),req.body||{})})}catch(error){res.status(400).json({success:false,error:error.message})}});
router.get("/crm-ai/operational/entity-rules", auth, async (req,res)=>{try{res.json({success:true,data:await listAiEntityRules(getEstablishmentId(req),req.query.entityType)})}catch(error){res.status(500).json({success:false,error:error.message})}});
router.put("/crm-ai/operational/entity-rules", auth, async (req,res)=>{try{if(!canManageAi(req))return res.status(403).json({success:false,error:"Sem permissao."});res.json({success:true,data:await saveAiEntityRule(getEstablishmentId(req),req.body||{})})}catch(error){res.status(400).json({success:false,error:error.message})}});
router.delete("/crm-ai/operational/entity-rules/:ruleId", auth, async (req,res)=>{try{if(!canManageAi(req))return res.status(403).json({success:false,error:"Sem permissao."});await deleteAiEntityRule(getEstablishmentId(req),req.params.ruleId);res.json({success:true})}catch(error){res.status(400).json({success:false,error:error.message})}});

router.post("/crm-ai/operational/waitlist", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    if (req.body?.confirmed !== true) return res.status(409).json({ success:false, error:"A confirmacao do cliente e obrigatoria para entrar na lista de espera." });
    const { customerId, petId, serviceId } = req.body || {};
    if (!customerId || !petId || !serviceId) return res.status(400).json({ success:false,error:"Tutor, pet e servico sao obrigatorios." });
    const row = await AiWaitlist.create({ usersId, conversationId:req.body.conversationId||null, customerId, petId, serviceId, preferredDates:Array.isArray(req.body.preferredDates)?req.body.preferredDates:[], preferredPeriods:Array.isArray(req.body.preferredPeriods)?req.body.preferredPeriods:[], consentAt:new Date() });
    res.status(201).json({ success:true,data:row });
  } catch(error) { res.status(500).json({success:false,error:error.message}); }
});

router.post("/crm-ai/operational/actions/:actionLogId/undo", auth, async (req, res) => {
  try {
    if (!canManageAi(req)) return res.status(403).json({success:false,error:"Sem permissao para desfazer."});
    const usersId=getEstablishmentId(req);
    const log=await AiCalendarActionLog.findOne({where:{id:req.params.actionLogId,usersId,status:"success",undoneAt:null}});
    if(!log) return res.status(404).json({success:false,error:"Acao reversivel nao encontrada."});
    const appointment=await Appointment.findOne({where:{id:log.appointmentId,usersId}});
    if(!appointment) return res.status(404).json({success:false,error:"Agendamento nao encontrado."});
    const previous=log.previousData||{};
    if(log.action==="appointment_reschedule") {
      const conflict=await Appointment.findOne({where:{usersId,date:previous.date,time:previous.time,id:{[Op.ne]:appointment.id},status:{[Op.notIn]:["Cancelado","cancelado","Finalizado","finalizado"]}}});
      if(conflict) return res.status(409).json({success:false,error:"Nao e possivel desfazer: o horario anterior ja foi ocupado."});
      await appointment.update({date:previous.date,time:previous.time,responsibleId:previous.responsibleId||null});
    } else if(log.action==="appointment_cancel") await appointment.update({status:previous.status,observation:previous.observation});
    else return res.status(409).json({success:false,error:"Esta acao nao pode ser desfeita automaticamente."});
    await log.update({status:"undone",undoneAt:new Date()});
    res.json({success:true,data:{appointment,log}});
  } catch(error){res.status(500).json({success:false,error:error.message});}
});

router.post("/crm-ai/operational/actions/:actionName", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const { actionName } = req.params;
    const result = await executeCrmAiOperationalAction(
      {
        usersId,
        authorUserId: req.user?.id || usersId,
      },
      actionName,
      req.body || {},
    );
    const statusCode = result?.success === false ? (result.blocked ? 409 : 400) : 200;
    res.status(statusCode).json(result);
  } catch (error) {
    console.error("[CRM AI Operational] action:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Nao foi possivel executar a acao operacional da IA.",
    });
  }
});

export default router;
