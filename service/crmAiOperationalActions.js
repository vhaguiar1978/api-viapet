import { Op } from "sequelize";
import Appointment from "../models/Appointment.js";
import AppointmentItem from "../models/AppointmentItem.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import AiSettings from "../models/AiSettings.js";
import CrmAiActionLog from "../models/CrmAiActionLog.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import Custumers from "../models/Custumers.js";
import Finance from "../models/Finance.js";
import PaymentProof from "../models/PaymentProof.js";
import Pets from "../models/Pets.js";
import ProductRecommendationRule from "../models/ProductRecommendationRule.js";
import Products from "../models/Products.js";
import Receivable from "../models/Receivable.js";
import Services from "../models/Services.js";
import Settings from "../models/Settings.js";
import sequelize from "../database/config.js";
import { getAvailableSlots } from "./agendaAvailability.js";
import { sendTextMessage } from "./whatsappOfficial/whatsappSendService.js";
import { checkAiPermission, OPERATIONAL_PERMISSION_ACTIONS } from "./aiPermissionService.js";
import AiCalendarApproval from "../models/AiCalendarApproval.js";
import AiCalendarActionLog from "../models/AiCalendarActionLog.js";
import AiWaitlist from "../models/AiWaitlist.js";
import { validateAiCalendarMutation } from "./aiCalendarRulesService.js";
import { getAiCalendarRules } from "./aiCalendarRulesService.js";

const ACTIONS_REQUIRING_CONFIRMATION = new Set([
  "criar_agendamento",
  "adicionar_servico_ao_agendamento",
  "registrar_pagamento_agenda",
  "marcar_conta_como_paga",
]);

const ACTION_PERMISSION_FLAGS = {
  criar_tutor: "allowAiRegisterNewCustomer",
  criar_pet: "allowAiRegisterPet",
  criar_agendamento: "allowAiSchedule",
  adicionar_servico_ao_agendamento: "allowAiOfferExtraServices",
  listar_produtos_recomendados: "allowAiOfferProducts",
  registrar_interesse_produto: "allowAiOfferProducts",
  registrar_comprovante: "allowAiReadPaymentProof",
  criar_conta_a_receber: "allowAiChargeCustomers",
  marcar_conta_como_paga: "allowAiReadPaymentProof",
  registrar_pagamento_agenda: "allowAiReadPaymentProof",
  gerar_relatorio_mensal_ia: "allowAiMonthlyReport",
};

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function ensureRequired(payload, fields = []) {
  const missing = fields.filter((field) => {
    const value = payload?.[field];
    return value === undefined || value === null || String(value).trim() === "";
  });
  if (missing.length) {
    const error = new Error(`Campos obrigatorios ausentes: ${missing.join(", ")}`);
    error.code = "missing_required_fields";
    error.missingFields = missing;
    throw error;
  }
}

function hasClearConfirmation(payload = {}) {
  if (payload.confirmed === true || payload.tutorConfirmed === true) return true;
  const text = normalizeText(payload.confirmationText || payload.lastCustomerMessage || "");
  if (!text || /\b(nao|não|cancelar|desisto)\b/.test(text)) return false;
  return /^(sim|ok|pode|confirmo|confirma|fechado|combinado)\b/.test(text) ||
    /\b(pode confirmar|pode agendar|esta confirmado|ta confirmado)\b/.test(text);
}

function mapCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    bairro: customer.bairro,
    city: customer.city,
    complement: customer.complement,
    observation: customer.observation,
  };
}

function mapPet(pet) {
  if (!pet) return null;
  return {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed,
    size: pet.size,
    approxWeight: pet.approxWeight,
    sex: pet.sex,
    allergic: pet.allergic,
    restrictions: pet.restrictions,
    behavior: pet.behavior,
    feedBrand: pet.feedBrand,
    hygienicCarpet: pet.hygienicCarpet,
    favoriteTreat: pet.favoriteTreat,
    treatEnabled: pet.treatEnabled,
    productPreferences: pet.productPreferences || [],
  };
}

function mapService(service) {
  if (!service) return null;
  return {
    id: service.id,
    name: service.name,
    price: Number(service.price || 0),
    durationMinutes: Number(service.duration || 0),
    category: service.category,
    aiCanSchedule: service.aiCanSchedule !== false,
    aiCanOffer: service.aiCanOffer !== false,
    requiresGroomer: Boolean(service.requiresGroomer),
    blocksParallelServices: Boolean(service.blocksParallelServices),
    maxParallelQuantity: Number(service.maxParallelQuantity || 1),
  };
}

async function getSettings(usersId) {
  const [settings, aiSettings] = await Promise.all([
    Settings.findOne({ where: { usersId } }),
    AiSettings.findOne({ where: { usersId } }),
  ]);
  return {
    settings: settings || {},
    aiSettings: aiSettings || null,
  };
}

async function getEffectiveAiSettings(usersId) {
  const [aiSettings, settings] = await Promise.all([
    AiSettings.findOne({ where: { usersId } }),
    Settings.findOne({ where: { usersId } }),
  ]);
  if (aiSettings) return aiSettings;

  const control = settings?.whatsappConnection?.crmAiControl || {};
  const capabilities = control?.capabilities || {};
  const scheduling = control?.scheduling || {};

  return {
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
  };
}

async function registerLog({
  usersId,
  conversationId,
  contactId,
  actionName,
  payload,
  result,
  status,
  confidenceScore = null,
  errorMessage = null,
  transaction = null,
}) {
  return CrmAiActionLog.create(
    {
      usersId,
      conversationId: conversationId || null,
      customerId: contactId || null,
      actionType: actionName,
      actionName,
      status,
      summary: actionName,
      executed: status === "success",
      payload: payload || {},
      actionPayload: payload || {},
      actionResult: result || {},
      confidenceScore,
      errorMessage,
    },
    { transaction },
  );
}

async function runLoggedAction(context, actionName, payload, handler) {
  const usersId = context.usersId;
  if (!usersId) throw new Error("tenant/usersId ausente para executar acao da IA");

  const granularAction = OPERATIONAL_PERMISSION_ACTIONS[actionName];
  if (granularAction) {
    const permission = await checkAiPermission(usersId, granularAction, {
      payload,
      humanApproved: payload?.humanApproved === true,
    });
    if (!permission.allowed || !permission.executable) {
      let approvalId = null;
      if (permission.reason === "human_approval_required") {
        const approval = await AiCalendarApproval.create({
          usersId, conversationId: payload?.conversationId || null,
          customerId: payload?.customerId || null, petId: payload?.petId || null,
          appointmentId: payload?.appointmentId || null, action: granularAction, payload,
        });
        approvalId = approval.id;
      }
      const result = {
        success: false,
        blocked: true,
        reason: permission.reason,
        permission: granularAction,
        permissionMode: permission.mode,
        approvalId,
        message: permission.reason === "customer_confirmation_required"
          ? "A IA precisa de confirmacao clara do cliente antes de executar esta acao."
          : permission.reason === "human_approval_required"
            ? "Esta acao esta aguardando aprovacao de um funcionario."
            : permission.reason === "ai_writes_paused"
              ? "As automacoes de escrita da IA estao pausadas pelo estabelecimento."
              : "Esta acao nao esta permitida nas configuracoes da IA.",
      };
      await registerLog({
        usersId,
        conversationId: payload?.conversationId,
        contactId: payload?.customerId || payload?.tutor_id || payload?.tutorId,
        actionName,
        payload,
        result,
        status: permission.reason === "human_approval_required" ? "waiting_approval" : "blocked",
      });
      return result;
    }
  }

  const permissionFlag = ACTION_PERMISSION_FLAGS[actionName];
  if (permissionFlag) {
    const settings = await getEffectiveAiSettings(usersId);
    const blocked =
      !settings ||
      settings.aiActive === false ||
      settings[permissionFlag] !== true;
    if (blocked) {
      const result = {
        success: false,
        blocked: true,
        reason: "ai_permission_disabled",
        permission: permissionFlag,
        message: "Esta acao nao esta liberada nas configuracoes operacionais da IA.",
      };
      await registerLog({
        usersId,
        conversationId: payload?.conversationId,
        contactId: payload?.customerId || payload?.tutor_id || payload?.tutorId,
        actionName,
        payload,
        result,
        status: "blocked",
      });
      return result;
    }
  }

  if (ACTIONS_REQUIRING_CONFIRMATION.has(actionName) && !hasClearConfirmation(payload)) {
    const result = {
      success: false,
      blocked: true,
      reason: "customer_confirmation_required",
      message: "A IA precisa de confirmacao clara do cliente antes de executar esta acao.",
    };
    await registerLog({
      usersId,
      conversationId: payload?.conversationId,
      contactId: payload?.customerId || payload?.tutor_id || payload?.tutorId,
      actionName,
      payload,
      result,
      status: "blocked",
    });
    return result;
  }

  try {
    const result = await handler();
    await registerLog({
      usersId,
      conversationId: payload?.conversationId,
      contactId: payload?.customerId || payload?.tutor_id || payload?.tutorId || result?.customer?.id,
      actionName,
      payload,
      result,
      status: result?.success === false ? "error" : "success",
      confidenceScore: result?.confidenceScore ?? null,
    });
    return result;
  } catch (error) {
    if (error.code === "human_approval_required") {
      const granularAction = OPERATIONAL_PERMISSION_ACTIONS[actionName] || actionName;
      const approval = await AiCalendarApproval.create({ usersId, conversationId: payload?.conversationId || null, customerId: payload?.customerId || null, petId: payload?.petId || null, appointmentId: payload?.appointmentId || null, action: granularAction, payload });
      const result = { success:false, blocked:true, reason:error.code, approvalId:approval.id, message:error.message };
      await registerLog({usersId,conversationId:payload?.conversationId,contactId:payload?.customerId,actionName,payload,result,status:"waiting_approval"});
      return result;
    }
    const result = {
      success: false,
      error: error.message || "Falha ao executar acao da IA.",
      code: error.code || "action_failed",
      missingFields: error.missingFields || [],
    };
    await registerLog({
      usersId,
      conversationId: payload?.conversationId,
      contactId: payload?.customerId || payload?.tutor_id || payload?.tutorId,
      actionName,
      payload,
      result,
      status: "error",
      errorMessage: result.error,
    });
    return result;
  }
}

async function findCustomerByPhone(usersId, phone) {
  const normalized = normalizePhone(phone);
  const digits = digitsOnly(phone);
  if (!digits) return null;

  return Custumers.findOne({
    where: {
      usersId,
      [Op.or]: [
        { phone: normalized },
        { phone: digits },
        { phone: { [Op.like]: `%${digits.slice(-8)}%` } },
      ],
    },
  });
}

async function findPet(usersId, customerId, petId) {
  if (!petId) return null;
  return Pets.findOne({
    where: {
      usersId,
      custumerId: customerId,
      id: petId,
    },
  });
}

async function getAppointmentHistory(usersId, customerId, limit = 5) {
  return Appointment.findAll({
    where: { usersId, customerId },
    include: [{ model: Services }],
    order: [["date", "DESC"], ["time", "DESC"]],
    limit,
  });
}

export async function buscarClientePorTelefone(context, payload = {}) {
  return runLoggedAction(context, "buscar_cliente_por_telefone", payload, async () => {
    ensureRequired(payload, ["telefone"]);
    const customer = await findCustomerByPhone(context.usersId, payload.telefone);
    if (!customer) {
      return {
        success: true,
        found: false,
        phone: normalizePhone(payload.telefone),
        pets: [],
        appointments: [],
        receivables: [],
      };
    }

    const [pets, appointments, receivables] = await Promise.all([
      Pets.findAll({ where: { usersId: context.usersId, custumerId: customer.id }, order: [["name", "ASC"]] }),
      getAppointmentHistory(context.usersId, customer.id),
      Receivable.findAll({
        where: { usersId: context.usersId, customerId: customer.id, status: { [Op.in]: ["open", "overdue", "partial"] } },
        order: [["dueDate", "ASC"]],
      }).catch(() => []),
    ]);

    return {
      success: true,
      found: true,
      customer: mapCustomer(customer),
      pets: pets.map(mapPet),
      appointments: appointments.map((item) => ({
        id: item.id,
        date: item.date,
        time: String(item.time || "").slice(0, 5),
        status: item.status,
        service: item.Service?.name || null,
        paymentStatus: item.paymentStatus || null,
      })),
      receivables,
    };
  });
}

export async function criarTutor(context, payload = {}) {
  return runLoggedAction(context, "criar_tutor", payload, async () => {
    ensureRequired(payload, ["name", "phone"]);
    const existing = await findCustomerByPhone(context.usersId, payload.phone);
    if (existing) {
      return { success: true, alreadyExists: true, customer: mapCustomer(existing) };
    }

    const customer = await Custumers.create({
      usersId: context.usersId,
      name: String(payload.name || "").trim(),
      phone: normalizePhone(payload.phone),
      email: String(payload.email || "").trim() || null,
      address: String(payload.address || payload.endereco || "").trim() || null,
      bairro: String(payload.bairro || "").trim() || null,
      city: String(payload.city || payload.cidade || "").trim() || null,
      complement: String(payload.complement || payload.complemento || "").trim() || null,
      observation: String(payload.observation || payload.observacoes || "").trim() || null,
      status: true,
    });
    return { success: true, customer: mapCustomer(customer) };
  });
}

export async function atualizarTutor(context, payload = {}) {
  return runLoggedAction(context, "atualizar_tutor", payload, async () => {
    ensureRequired(payload, ["customerId"]);
    const customer = await Custumers.findOne({ where: { usersId: context.usersId, id: payload.customerId } });
    if (!customer) throw new Error("Tutor nao encontrado neste tenant.");
    await customer.update({
      name: payload.name ?? customer.name,
      phone: payload.phone ? normalizePhone(payload.phone) : customer.phone,
      email: payload.email ?? customer.email,
      address: payload.address ?? customer.address,
      bairro: payload.bairro ?? customer.bairro,
      city: payload.city ?? customer.city,
      complement: payload.complement ?? customer.complement,
      observation: payload.observation ?? customer.observation,
    });
    return { success: true, customer: mapCustomer(customer) };
  });
}

export async function criarPet(context, payload = {}) {
  return runLoggedAction(context, "criar_pet", payload, async () => {
    ensureRequired(payload, ["customerId", "name"]);
    const customer = await Custumers.findOne({ where: { usersId: context.usersId, id: payload.customerId } });
    if (!customer) throw new Error("Tutor nao encontrado neste tenant.");
    const pet = await Pets.create({
      usersId: context.usersId,
      custumerId: customer.id,
      name: String(payload.name || "").trim(),
      species: String(payload.species || payload.especie || "").trim() || null,
      breed: String(payload.breed || payload.raca || "").trim() || null,
      size: String(payload.size || payload.porte || "").trim() || null,
      approxWeight: String(payload.approxWeight || payload.peso || "").trim() || null,
      sex: payload.sex || payload.sexo || null,
      behavior: payload.behavior || payload.comportamento || null,
      restrictions: payload.restrictions || payload.restricoes || null,
      allergic: payload.allergic || payload.alergias || null,
      observation: payload.observation || payload.observacoes || null,
      feedBrand: payload.feedBrand || payload.racao || null,
      hygienicCarpet: payload.hygienicCarpet || payload.tapeteHigienico || null,
      favoriteTreat: payload.favoriteTreat || payload.petisco || null,
      treatEnabled: payload.treatEnabled ?? null,
      productPreferences: Array.isArray(payload.productPreferences) ? payload.productPreferences : [],
      photoUrl: payload.photoUrl || null,
    });
    return { success: true, pet: mapPet(pet) };
  });
}

export async function atualizarPet(context, payload = {}) {
  return runLoggedAction(context, "atualizar_pet", payload, async () => {
    ensureRequired(payload, ["petId"]);
    const pet = await Pets.findOne({ where: { usersId: context.usersId, id: payload.petId } });
    if (!pet) throw new Error("Pet nao encontrado neste tenant.");
    await pet.update({
      name: payload.name ?? pet.name,
      species: payload.species ?? pet.species,
      breed: payload.breed ?? pet.breed,
      size: payload.size ?? pet.size,
      approxWeight: payload.approxWeight ?? pet.approxWeight,
      sex: payload.sex ?? pet.sex,
      behavior: payload.behavior ?? pet.behavior,
      restrictions: payload.restrictions ?? pet.restrictions,
      allergic: payload.allergic ?? pet.allergic,
      observation: payload.observation ?? pet.observation,
      feedBrand: payload.feedBrand ?? pet.feedBrand,
      hygienicCarpet: payload.hygienicCarpet ?? pet.hygienicCarpet,
      favoriteTreat: payload.favoriteTreat ?? pet.favoriteTreat,
      treatEnabled: payload.treatEnabled ?? pet.treatEnabled,
      productPreferences: Array.isArray(payload.productPreferences) ? payload.productPreferences : pet.productPreferences,
      photoUrl: payload.photoUrl ?? pet.photoUrl,
    });
    return { success: true, pet: mapPet(pet) };
  });
}

export async function listarServicosDisponiveis(context, payload = {}) {
  return runLoggedAction(context, "listar_servicos_disponiveis", payload, async () => {
    const services = await Services.findAll({
      where: {
        establishment: context.usersId,
        [Op.or]: [{ aiCanOffer: true }, { aiCanOffer: null }],
      },
      order: [["category", "ASC"], ["name", "ASC"]],
    });
    return { success: true, services: services.map(mapService) };
  });
}

export async function consultarHorariosDisponiveis(context, payload = {}) {
  return runLoggedAction(context, "consultar_horarios_disponiveis", payload, async () => {
    ensureRequired(payload, ["date"]);
    const { settings } = await getSettings(context.usersId);
    const [calendarRules, service] = await Promise.all([
      getAiCalendarRules(context.usersId),
      payload.serviceId ? Services.findOne({ where: { establishment: context.usersId, id: payload.serviceId } }) : null,
    ]);
    const slots = await getAvailableSlots({
      usersId: context.usersId,
      date: payload.date,
      period: payload.period || null,
      type: payload.type || "estetica",
      settings,
      aiControl: payload.aiControl || settings?.whatsappConnection?.crmAiControl || {},
      calendarRules,
      serviceDurationMinutes: Number(service?.duration || 0),
      maxSlots: Number(payload.maxSlots || 6),
    });
    return { success: true, ...slots };
  });
}

export async function criarAgendamento(context, payload = {}) {
  return runLoggedAction(context, "criar_agendamento", payload, async () => {
    ensureRequired(payload, ["customerId", "petId", "serviceId", "date", "time"]);
    const [customer, pet, service] = await Promise.all([
      Custumers.findOne({ where: { usersId: context.usersId, id: payload.customerId } }),
      findPet(context.usersId, payload.customerId, payload.petId),
      Services.findOne({ where: { establishment: context.usersId, id: payload.serviceId } }),
    ]);
    if (!customer) throw new Error("Tutor nao encontrado neste tenant.");
    if (!pet) throw new Error("Pet nao encontrado para este tutor.");
    if (!service || service.aiCanSchedule === false) throw new Error("Servico nao encontrado ou nao liberado para IA.");
    await validateAiCalendarMutation({ usersId: context.usersId, action: "appointment_create", payload, service });

    const existing = await Appointment.findOne({
      where: {
        usersId: context.usersId,
        petId: pet.id,
        date: payload.date,
        time: payload.time,
        status: { [Op.notIn]: ["cancelado", "Cancelado", "finalizado", "Finalizado"] },
      },
    });
    if (existing) throw new Error("Ja existe agendamento para este pet no mesmo horario.");

    const created = await sequelize.transaction(async (transaction) => {
      const finance = await Finance.create(
        {
          usersId: context.usersId,
          createdBy: context.authorUserId || context.usersId,
          type: "entrada",
          description: `Agendamento IA - ${service.name} - ${pet.name}`,
          amount: Number(service.price || payload.amount || 0),
          grossAmount: Number(service.price || payload.amount || 0),
          netAmount: Number(service.price || payload.amount || 0),
          date: new Date(`${payload.date}T${String(payload.time).slice(0, 5)}:00`),
          dueDate: new Date(`${payload.date}T12:00:00`),
          category: "Servicos",
          subCategory: service.category || "Agenda",
          expenseType: "variavel",
          frequency: "unico",
          paymentMethod: payload.paymentMethod || "pendente",
          status: "pendente",
          reference: "appointment",
          notes: "Criado pela IA operacional do CRM",
        },
        { transaction },
      );

      const appointment = await Appointment.create(
        {
          usersId: context.usersId,
          customerId: customer.id,
          petId: pet.id,
          serviceId: service.id,
          responsibleId: payload.professionalId || null,
          type: payload.type || "estetica",
          date: payload.date,
          time: payload.time,
          status: "Agendado",
          observation: payload.notes || "Criado pela IA operacional do CRM",
          whatsapp: true,
          financeId: finance.id,
          paymentMethod: payload.paymentMethod || null,
          paymentStatus: "pending",
          paymentAmount: Number(service.price || payload.amount || 0),
          createdByType: "ai",
          createdByAi: true,
          aiOverbooking: payload.overbooking === true,
        },
        { transaction },
      );

      return {
        success: true,
        appointmentId: appointment.id,
        financeId: finance.id,
        appointment,
      };
    });
    const actionLog = await AiCalendarActionLog.create({ usersId: context.usersId, conversationId: payload.conversationId || null, customerId: customer.id, petId: pet.id, appointmentId: created.appointment.id, action: "appointment_create", permissionMode: payload.humanApproved ? "human_approval" : "customer_confirmation", previousData: {}, newData: { date: created.appointment.date, time: created.appointment.time, serviceId: service.id, responsibleId: created.appointment.responsibleId }, confirmedByCustomer: payload.tutorConfirmed === true || payload.confirmed === true, approvedByUserId: payload.humanApproved ? context.authorUserId : null, toolCalled: "criar_agendamento", status: "success" });
    await created.appointment.update({ aiActionLogId: actionLog.id });
    return { ...created, actionLogId: actionLog.id };
  });
}

export async function remarcarAgendamento(context, payload = {}) {
  return runLoggedAction(context, "remarcar_agendamento", payload, async () => {
    ensureRequired(payload, ["appointmentId", "date", "time"]);
    const appointment = await Appointment.findOne({ where: { usersId: context.usersId, id: payload.appointmentId } });
    if (!appointment) throw new Error("Agendamento nao encontrado neste estabelecimento.");
    const previousData = { date: appointment.date, time: appointment.time, responsibleId: appointment.responsibleId };
    const service = await Services.findOne({ where: { establishment: context.usersId, id: appointment.serviceId } });
    await validateAiCalendarMutation({ usersId: context.usersId, action: "appointment_reschedule", payload: { ...payload, customerId: appointment.customerId, petId: appointment.petId, serviceId: appointment.serviceId }, appointment, service });
    const conflict = await Appointment.findOne({ where: { usersId: context.usersId, date: payload.date, time: payload.time, id: { [Op.ne]: appointment.id }, status: { [Op.notIn]: ["cancelado", "Cancelado", "finalizado", "Finalizado"] } } });
    if (conflict) throw new Error("O horario escolhido nao esta mais disponivel.");
    await appointment.update({ date: payload.date, time: payload.time, responsibleId: payload.professionalId ?? appointment.responsibleId, aiOverbooking: payload.overbooking === true, observation: `${appointment.observation || ""}\nRemarcado pela ViaPet IA`.trim() });
    const log = await AiCalendarActionLog.create({ usersId: context.usersId, conversationId: payload.conversationId || null, customerId: appointment.customerId, petId: appointment.petId, appointmentId: appointment.id, action: "appointment_reschedule", permissionMode: payload.humanApproved ? "human_approval" : "customer_confirmation", previousData, newData: { date: appointment.date, time: appointment.time, responsibleId: appointment.responsibleId }, confirmedByCustomer: payload.tutorConfirmed === true || payload.confirmed === true, approvedByUserId: payload.humanApproved ? context.authorUserId : null, toolCalled: "remarcar_agendamento", status: "success" });
    await appointment.update({ aiActionLogId: log.id });
    return { success: true, appointment, actionLogId: log.id };
  });
}

export async function cancelarAgendamento(context, payload = {}) {
  return runLoggedAction(context, "cancelar_agendamento", payload, async () => {
    ensureRequired(payload, ["appointmentId"]);
    const appointment = await Appointment.findOne({ where: { usersId: context.usersId, id: payload.appointmentId } });
    if (!appointment) throw new Error("Agendamento nao encontrado neste estabelecimento.");
    const previousData = { status: appointment.status, observation: appointment.observation };
    const validation = await validateAiCalendarMutation({ usersId: context.usersId, action: "appointment_cancel", payload, appointment });
    const informedReason = String(payload.reason || payload.motivo || "").trim();
    if (validation.rules?.settings?.requireCancellationReason === true && !informedReason) { const error = new Error("Informe o motivo do cancelamento antes de continuar."); error.code = "cancellation_reason_required"; throw error; }
    const reason = informedReason || "Cancelado a pedido do tutor";
    await appointment.update({ status: "Cancelado", observation: `${appointment.observation || ""}\nViaPet IA: ${reason}`.trim() });
    const log = await AiCalendarActionLog.create({ usersId: context.usersId, conversationId: payload.conversationId || null, customerId: appointment.customerId, petId: appointment.petId, appointmentId: appointment.id, action: "appointment_cancel", permissionMode: payload.humanApproved ? "human_approval" : "customer_confirmation", previousData, newData: { status: appointment.status, reason }, confirmedByCustomer: payload.tutorConfirmed === true || payload.confirmed === true, approvedByUserId: payload.humanApproved ? context.authorUserId : null, toolCalled: "cancelar_agendamento", status: "success" });
    await appointment.update({ aiActionLogId: log.id });
    const waitlistMatches = await AiWaitlist.findAll({
      where: { usersId: context.usersId, serviceId: appointment.serviceId, status: "waiting" },
      order: [["createdAt", "ASC"]], limit: 20,
    }).then((rows) => rows.filter((row) => {
      const dates = Array.isArray(row.preferredDates) ? row.preferredDates : [];
      return !dates.length || dates.includes(String(appointment.date));
    }));
    const notifiedWaitlistIds = [];
    if (validation.rules?.settings?.autoNotifyWaitlist === true) {
      for (const match of waitlistMatches.slice(0, 5)) {
        const customer = await Custumers.findOne({ where: { usersId: context.usersId, id: match.customerId } });
        if (!customer?.phone) continue;
        const sent = await sendTextMessage({ companyId: context.usersId, to: customer.phone, body: `Oi, ${String(customer.name || "").split(" ")[0]}! Surgiu uma vaga em ${appointment.date} as ${String(appointment.time).slice(0, 5)}. Quer que eu confirme para voce?`, conversationId: match.conversationId || null }).catch(() => null);
        if (sent) { notifiedWaitlistIds.push(match.id); await match.update({ status: "offered" }); }
      }
    }
    return { success: true, appointment, actionLogId: log.id, releasedSlot: { date: appointment.date, time: appointment.time }, waitlistMatches, notifiedWaitlistIds };
  });
}

export async function adicionarServicoAoAgendamento(context, payload = {}) {
  return runLoggedAction(context, "adicionar_servico_ao_agendamento", payload, async () => {
    ensureRequired(payload, ["appointmentId", "serviceId"]);
    const [appointment, service] = await Promise.all([
      Appointment.findOne({ where: { usersId: context.usersId, id: payload.appointmentId } }),
      Services.findOne({ where: { establishment: context.usersId, id: payload.serviceId } }),
    ]);
    if (!appointment) throw new Error("Agendamento nao encontrado neste tenant.");
    if (!service || service.aiCanOffer === false) throw new Error("Servico extra nao encontrado ou nao liberado para IA.");

    const item = await AppointmentItem.create({
      appointmentId: appointment.id,
      usersId: context.usersId,
      type: "service",
      serviceId: service.id,
      description: service.name,
      quantity: 1,
      unitPrice: Number(service.price || 0),
      total: Number(service.price || 0),
      observation: "Servico extra adicionado pela IA",
      createdBy: context.authorUserId || context.usersId,
    });
    return { success: true, itemId: item.id, service: mapService(service) };
  });
}

export async function listarProdutosRecomendados(context, payload = {}) {
  return runLoggedAction(context, "listar_produtos_recomendados", payload, async () => {
    ensureRequired(payload, ["petId"]);
    const pet = await Pets.findOne({ where: { usersId: context.usersId, id: payload.petId } });
    if (!pet) throw new Error("Pet nao encontrado neste tenant.");

    const triggers = [
      pet.feedBrand,
      pet.hygienicCarpet,
      pet.favoriteTreat,
      ...(Array.isArray(pet.productPreferences) ? pet.productPreferences : []),
    ]
      .map((item) => normalizeText(item))
      .filter(Boolean);

    const rules = triggers.length
      ? await ProductRecommendationRule.findAll({
          where: {
            usersId: context.usersId,
            active: true,
            triggerValue: { [Op.in]: triggers },
          },
          order: [["priority", "DESC"]],
        }).catch(() => [])
      : [];

    const productWhere = {
      usersId: context.usersId,
      [Op.or]: [],
    };
    if (rules.length) productWhere[Op.or].push({ id: { [Op.in]: rules.map((rule) => rule.productId) } });
    for (const trigger of triggers) {
      productWhere[Op.or].push({ name: { [Op.like]: `%${trigger}%` } });
      productWhere[Op.or].push({ category: { [Op.like]: `%${trigger}%` } });
    }
    if (!productWhere[Op.or].length) return { success: true, products: [] };

    const products = await Products.findAll({
      where: productWhere,
      limit: Number(payload.limit || 5),
      order: [["name", "ASC"]],
    });

    return {
      success: true,
      products: products
        .filter((product) => product.stoke == null || Number(product.stoke) > 0)
        .map((product) => ({
          id: product.id,
          name: product.name,
          price: Number(product.price || 0),
          stock: product.stoke,
          category: product.category,
        })),
    };
  });
}

export async function registrarInteresseProduto(context, payload = {}) {
  return runLoggedAction(context, "registrar_interesse_produto", payload, async () => {
    ensureRequired(payload, ["customerId", "petId", "productId"]);
    const [conversation, product] = await Promise.all([
      payload.conversationId ? CrmConversation.findOne({ where: { usersId: context.usersId, id: payload.conversationId } }) : null,
      Products.findOne({ where: { usersId: context.usersId, id: payload.productId } }),
    ]);
    if (!product) throw new Error("Produto nao encontrado neste tenant.");
    if (conversation) {
      await CrmConversationMessage.create({
        conversationId: conversation.id,
        usersId: context.usersId,
        customerId: payload.customerId,
        petId: payload.petId,
        direction: "outbound",
        channel: "system",
        messageType: "note",
        body: `IA registrou interesse no produto: ${product.name}`,
        content: `IA registrou interesse no produto: ${product.name}`,
        role: "tool",
        payload: { action: "registrar_interesse_produto", productId: product.id },
        metadata: {},
      });
    }
    return { success: true, product: { id: product.id, name: product.name } };
  });
}

export async function criarContaAReceber(context, payload = {}) {
  return runLoggedAction(context, "criar_conta_a_receber", payload, async () => {
    ensureRequired(payload, ["customerId", "amount", "dueDate", "description"]);
    const customer = await Custumers.findOne({ where: { usersId: context.usersId, id: payload.customerId } });
    if (!customer) throw new Error("Tutor nao encontrado neste tenant.");
    const receivable = await Receivable.create({
      usersId: context.usersId,
      customerId: customer.id,
      petId: payload.petId || null,
      appointmentId: payload.appointmentId || null,
      packageId: payload.packageId || null,
      originType: payload.originType || payload.origem || "manual",
      description: payload.description,
      amount: Number(payload.amount || 0),
      dueDate: payload.dueDate,
      status: "open",
      notes: payload.notes || null,
    });
    return { success: true, receivable };
  });
}

export async function marcarContaComoPaga(context, payload = {}) {
  return runLoggedAction(context, "marcar_conta_como_paga", payload, async () => {
    ensureRequired(payload, ["receivableId", "amountPaid"]);
    const receivable = await Receivable.findOne({ where: { usersId: context.usersId, id: payload.receivableId } });
    if (!receivable) throw new Error("Conta a receber nao encontrada neste tenant.");
    if (receivable.status === "paid") return { success: true, alreadyPaid: true, receivable };
    await receivable.update({
      status: "paid",
      paidAt: payload.paymentDate ? new Date(payload.paymentDate) : new Date(),
      paymentMethod: payload.paymentMethod || receivable.paymentMethod,
      notes: payload.notes || receivable.notes,
    });
    if (receivable.appointmentId) {
      await Appointment.update(
        {
          paymentStatus: "paid",
          paidAt: receivable.paidAt,
          paymentMethod: receivable.paymentMethod,
          paymentProofId: payload.paymentProofId || null,
        },
        { where: { usersId: context.usersId, id: receivable.appointmentId } },
      );
    }
    return { success: true, receivable };
  });
}

export async function registrarPagamentoAgenda(context, payload = {}) {
  return runLoggedAction(context, "registrar_pagamento_agenda", payload, async () => {
    ensureRequired(payload, ["appointmentId", "amount", "paymentMethod"]);
    const appointment = await Appointment.findOne({ where: { usersId: context.usersId, id: payload.appointmentId } });
    if (!appointment) throw new Error("Agendamento nao encontrado neste tenant.");

    await appointment.update({
      paymentStatus: Number(payload.amount || 0) >= Number(appointment.paymentAmount || payload.amount || 0) ? "paid" : "partial",
      paymentAmount: payload.amount,
      paymentMethod: payload.paymentMethod,
      paidAt: payload.paidAt ? new Date(payload.paidAt) : new Date(),
      paymentProofId: payload.paymentProofId || appointment.paymentProofId,
    });

    await AppointmentPayment.create({
      appointmentId: appointment.id,
      usersId: context.usersId,
      dueDate: appointment.date,
      paymentMethod: payload.paymentMethod,
      details: payload.notes || "Pagamento registrado pela IA",
      amount: Number(payload.amount || 0),
      grossAmount: Number(payload.amount || 0),
      netAmount: Number(payload.amount || 0),
      status: "pago",
      paidAt: appointment.paidAt || new Date(),
      createdBy: context.authorUserId || context.usersId,
    });

    return { success: true, appointmentId: appointment.id, paymentStatus: appointment.paymentStatus };
  });
}

export async function registrarComprovante(context, payload = {}) {
  return runLoggedAction(context, "registrar_comprovante", payload, async () => {
    ensureRequired(payload, ["mediaUrl"]);
    if (payload.extractedTransactionId) {
      const duplicate = await PaymentProof.findOne({
        where: {
          usersId: context.usersId,
          extractedTransactionId: payload.extractedTransactionId,
          status: { [Op.notIn]: ["rejected"] },
        },
      });
      if (duplicate) throw new Error("Comprovante duplicado: transaction_id ja registrado.");
    }
    const proof = await PaymentProof.create({
      usersId: context.usersId,
      conversationId: payload.conversationId || null,
      customerId: payload.customerId || null,
      appointmentId: payload.appointmentId || null,
      receivableId: payload.receivableId || null,
      mediaUrl: payload.mediaUrl,
      extractedAmount: payload.extractedAmount ?? null,
      extractedDate: payload.extractedDate ?? null,
      extractedPayerName: payload.extractedPayerName || null,
      extractedReceiverName: payload.extractedReceiverName || null,
      extractedTransactionId: payload.extractedTransactionId || null,
      confidenceScore: payload.confidenceScore ?? null,
      status: payload.status || "pending_review",
      rawExtraction: payload.rawExtraction || {},
    });
    return { success: true, paymentProof: proof, confidenceScore: payload.confidenceScore ?? null };
  });
}

export async function enviarMensagemWhatsapp(context, payload = {}) {
  return runLoggedAction(context, "enviar_mensagem_whatsapp", payload, async () => {
    ensureRequired(payload, ["telefone", "mensagem"]);
    const sent = await sendTextMessage({
      companyId: context.usersId,
      to: payload.telefone,
      body: payload.mensagem,
      conversationId: payload.conversationId || null,
    });
    return { success: true, sent };
  });
}

export async function encaminharParaHumano(context, payload = {}) {
  return runLoggedAction(context, "encaminhar_para_humano", payload, async () => {
    ensureRequired(payload, ["conversationId", "motivo"]);
    const conversation = await CrmConversation.findOne({ where: { usersId: context.usersId, id: payload.conversationId } });
    if (!conversation) throw new Error("Conversa nao encontrada neste tenant.");
    await conversation.update({
      status: "attending",
      aiEnabled: false,
      metadata: {
        ...(conversation.metadata || {}),
        aiPausedAt: new Date().toISOString(),
        escalationReason: payload.motivo,
      },
    });
    return { success: true, conversationId: conversation.id, status: conversation.status };
  });
}

export async function gerarRelatorioMensalIa(context, payload = {}) {
  return runLoggedAction(context, "gerar_relatorio_mensal_ia", payload, async () => {
    ensureRequired(payload, ["month", "year"]);
    const month = Number(payload.month);
    const year = Number(payload.year);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [appointments, finances, openReceivables] = await Promise.all([
      Appointment.findAll({
        where: {
          usersId: context.usersId,
          date: { [Op.gte]: start.toISOString().slice(0, 10), [Op.lt]: end.toISOString().slice(0, 10) },
        },
        include: [{ model: Services }],
      }),
      Finance.findAll({ where: { usersId: context.usersId, date: { [Op.gte]: start, [Op.lt]: end } } }),
      Receivable.findAll({ where: { usersId: context.usersId, status: { [Op.in]: ["open", "overdue", "partial"] } } }).catch(() => []),
    ]);

    const byService = appointments.reduce((acc, appointment) => {
      const name = normalizeText(appointment.Service?.name || appointment.type || "outros");
      if (name.includes("banho")) acc.banhos += 1;
      else if (name.includes("tosa")) acc.tosas += 1;
      else acc.outros += 1;
      return acc;
    }, { banhos: 0, tosas: 0, outros: 0 });

    const income = finances.filter((item) => item.type === "entrada" && item.status === "pago");
    const expenses = finances.filter((item) => item.type === "saida" && item.status === "pago");
    const receivedTotal = income.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const paidTotal = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const result = receivedTotal - paidTotal;

    const message = [
      `Resumo mensal ViaPet - ${String(month).padStart(2, "0")}/${year}`,
      "",
      "Foram feitos:",
      `* ${byService.banhos} banhos`,
      `* ${byService.tosas} tosas`,
      `* ${byService.outros} servicos extras/outros`,
      "",
      "Entradas:",
      `* Total recebido: R$ ${receivedTotal.toFixed(2)}`,
      "",
      "Saidas:",
      `* Total pago: R$ ${paidTotal.toFixed(2)}`,
      "",
      "Resultado final:",
      `R$ ${Math.abs(result).toFixed(2)} ${result >= 0 ? "positivo" : "negativo"}`,
      "",
      `Contas em aberto: ${openReceivables.length}`,
    ].join("\n");

    return {
      success: true,
      summary: {
        ...byService,
        receivedTotal,
        paidTotal,
        result,
        openReceivables: openReceivables.length,
      },
      message,
    };
  });
}

export const CRM_AI_OPERATIONAL_ACTIONS = {
  buscar_cliente_por_telefone: buscarClientePorTelefone,
  criar_tutor: criarTutor,
  atualizar_tutor: atualizarTutor,
  criar_pet: criarPet,
  atualizar_pet: atualizarPet,
  listar_servicos_disponiveis: listarServicosDisponiveis,
  consultar_horarios_disponiveis: consultarHorariosDisponiveis,
  criar_agendamento: criarAgendamento,
  remarcar_agendamento: remarcarAgendamento,
  cancelar_agendamento: cancelarAgendamento,
  adicionar_servico_ao_agendamento: adicionarServicoAoAgendamento,
  listar_produtos_recomendados: listarProdutosRecomendados,
  registrar_interesse_produto: registrarInteresseProduto,
  registrar_pagamento_agenda: registrarPagamentoAgenda,
  criar_conta_a_receber: criarContaAReceber,
  marcar_conta_como_paga: marcarContaComoPaga,
  registrar_comprovante: registrarComprovante,
  enviar_mensagem_whatsapp: enviarMensagemWhatsapp,
  encaminhar_para_humano: encaminharParaHumano,
  gerar_relatorio_mensal_ia: gerarRelatorioMensalIa,
};

export async function executeCrmAiOperationalAction(context, actionName, payload = {}) {
  const action = CRM_AI_OPERATIONAL_ACTIONS[actionName];
  if (!action) {
    throw new Error(`Acao operacional da IA nao encontrada: ${actionName}`);
  }
  return action(context, payload);
}
