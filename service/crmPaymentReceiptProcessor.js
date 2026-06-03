import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { Op } from "sequelize";
import Appointment from "../models/Appointment.js";
import AppointmentItem from "../models/AppointmentItem.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Settings from "../models/Settings.js";
import {
  calculateAppointmentSummary,
  logAppointmentEvent,
  resolveFeeBreakdownForMethod,
  syncAppointmentFinance,
} from "./appointmentFinance.js";
import { geminiFilePrompt } from "./geminiClient.js";
import { getConnectionByCompany } from "./whatsappOfficial/whatsappConnectionService.js";

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const AUTO_APPLY_THRESHOLD = 0.92;
const AMBIGUITY_MARGIN = 0.08;
const RECEIPT_TERMS =
  /(comprovante|pix|pagamento|pago|transferencia|transfer[eê]ncia|ted|doc|boleto|valor pago|valor da transa[cç][aã]o|identificador|end-to-end|e2e)/i;
const TEXT_AMOUNT_PATTERNS = [
  /(?:r\$\s*|rs\s*)(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})/gi,
  /(?:valor|total|quantia|pagamento|pago|pix|transfer[eê]ncia)\D{0,28}(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})/gi,
];

const toNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function normalizeMoney(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(2)) : null;

  let raw = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!raw) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const pieces = raw.split(".");
    if (pieces.length > 2) {
      const decimal = pieces.pop();
      raw = `${pieces.join("")}.${decimal}`;
    }
  }

  const amount = Number.parseFloat(raw);
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null;
}

function dateOnly(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
    return Number.isFinite(date.getTime()) ? dateOnly(date) : null;
  }

  const br = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (!br) return null;

  const day = Number(br[1]);
  const month = Number(br[2]);
  let year = Number(br[3]);
  if (year < 100) year += 2000;
  if (year < 2020 || year > 2035 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(year, month - 1, day, 12, 0, 0);
  return Number.isFinite(date.getTime()) ? dateOnly(date) : null;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeMethod(value = "") {
  const text = String(value || "").toLowerCase();
  if (text.includes("pix")) return "Pix";
  if (text.includes("boleto")) return "Boleto";
  if (text.includes("credito") || text.includes("crédito")) return "Cartao de credito";
  if (text.includes("debito") || text.includes("débito")) return "Cartao de debito";
  if (text.includes("transfer") || text.includes("ted") || text.includes("doc")) {
    return "Transferencia";
  }
  if (text.includes("dinheiro")) return "Dinheiro";
  return "";
}

function uniqueAmounts(amounts = []) {
  const seen = new Set();
  return amounts
    .map(normalizeMoney)
    .filter((amount) => amount && amount > 0)
    .filter((amount) => {
      const key = amount.toFixed(2);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function collectMessageText(message) {
  const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
  const source = payload.message || payload;
  const pieces = [
    message?.body,
    payload.caption,
    payload.fileName,
    payload.filename,
    payload.document?.filename,
    payload.document?.caption,
    payload.image?.caption,
    source?.document?.filename,
    source?.document?.caption,
    source?.image?.caption,
    source?.text?.body,
    source?.button?.text,
  ];

  return pieces
    .map((piece) => String(piece || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
}

function extractReceiptFromText(text = "") {
  const normalizedText = String(text || "");
  const amountCandidates = [];
  for (const pattern of TEXT_AMOUNT_PATTERNS) {
    let match = pattern.exec(normalizedText);
    while (match) {
      amountCandidates.push(match[1]);
      match = pattern.exec(normalizedText);
    }
  }

  const dateMatch =
    normalizedText.match(/\b(20\d{2}-\d{2}-\d{2})\b/) ||
    normalizedText.match(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/);

  return {
    isPaymentReceipt: RECEIPT_TERMS.test(normalizedText),
    amount: uniqueAmounts(amountCandidates)[0] || null,
    amountCandidates: uniqueAmounts(amountCandidates),
    paidAt: dateMatch ? parseDateOnly(dateMatch[1]) : null,
    paymentMethod: normalizeMethod(normalizedText),
    transactionId:
      normalizedText.match(/\b(?:e2e|end-to-end|identificador|id)\D{0,12}([a-z0-9.-]{12,})\b/i)?.[1] ||
      null,
    confidence: RECEIPT_TERMS.test(normalizedText) ? 0.55 : 0.2,
    source: "text",
  };
}

function parseJsonObject(content = "") {
  try {
    return JSON.parse(content);
  } catch (_) {
    const raw = String(content || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

async function loadGeminiApiKey(usersId) {
  const settings = await Settings.findOne({
    where: { usersId },
    attributes: ["whatsappConnection"],
  });
  const aiControl = settings?.whatsappConnection?.crmAiControl || {};
  return String(aiControl.geminiApiKey || process.env.GEMINI_API_KEY || "").trim();
}

function isProbablyMetaMediaId(value = "") {
  const mediaUrl = String(value || "").trim();
  return Boolean(mediaUrl) && !/^(https?:|data:|\/|[a-zA-Z]:\\)/.test(mediaUrl);
}

async function downloadMetaMedia({ usersId, mediaId, mimeType }) {
  const { accessToken } = await getConnectionByCompany(usersId);
  if (!accessToken) return null;

  const version = String(process.env.META_GRAPH_VERSION || "v21.0").trim();
  const mediaMeta = await axios.get(
    `https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 },
  );
  const downloadUrl = mediaMeta?.data?.url;
  if (!downloadUrl) return null;

  const response = await axios.get(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: "arraybuffer",
    timeout: 20000,
    maxContentLength: MAX_MEDIA_BYTES,
  });

  const buffer = Buffer.from(response.data);
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) return null;

  return {
    buffer,
    mimeType:
      mediaMeta?.data?.mime_type ||
      response.headers?.["content-type"] ||
      mimeType ||
      "application/octet-stream",
  };
}

async function loadMediaBuffer({ usersId, message }) {
  const mediaUrl = String(message?.mediaUrl || "").trim();
  if (!mediaUrl) return null;

  if (mediaUrl.startsWith("data:")) {
    const [, meta = "", data = ""] = mediaUrl.match(/^data:([^;]+);base64,(.+)$/) || [];
    if (!data) return null;
    const buffer = Buffer.from(data, "base64");
    return buffer.length <= MAX_MEDIA_BYTES ? { buffer, mimeType: meta || message?.mimeType } : null;
  }

  if (isProbablyMetaMediaId(mediaUrl)) {
    return downloadMetaMedia({ usersId, mediaId: mediaUrl, mimeType: message?.mimeType });
  }

  if (mediaUrl.startsWith("/uploads/")) {
    const filePath = path.join(process.cwd(), mediaUrl.replace(/^\//, ""));
    const buffer = await fs.readFile(filePath);
    return buffer.length <= MAX_MEDIA_BYTES ? { buffer, mimeType: message?.mimeType } : null;
  }

  if (/^[a-zA-Z]:\\/.test(mediaUrl)) {
    const buffer = await fs.readFile(mediaUrl);
    return buffer.length <= MAX_MEDIA_BYTES ? { buffer, mimeType: message?.mimeType } : null;
  }

  if (/^https?:\/\//i.test(mediaUrl)) {
    const response = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      timeout: 20000,
      maxContentLength: MAX_MEDIA_BYTES,
    });
    const buffer = Buffer.from(response.data);
    if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) return null;
    return {
      buffer,
      mimeType: response.headers?.["content-type"] || message?.mimeType,
    };
  }

  return null;
}

async function analyzeMediaWithGemini({ usersId, message, textHint }) {
  const apiKey = await loadGeminiApiKey(usersId);
  if (!apiKey) return null;

  const media = await loadMediaBuffer({ usersId, message });
  if (!media?.buffer?.length) return null;

  const mimeType = String(media.mimeType || message?.mimeType || "").split(";")[0].trim();
  if (!/^(image\/|application\/pdf$)/i.test(mimeType)) return null;

  const prompt = [
    "Voce e um leitor de comprovantes de pagamento para um CRM de pet shop.",
    "Analise o arquivo recebido e responda somente JSON valido.",
    "Se nao for comprovante de pagamento, marque isPaymentReceipt=false.",
    "Campos obrigatorios:",
    "{",
    '  "isPaymentReceipt": true|false,',
    '  "paymentMethod": "Pix|Boleto|Cartao de credito|Cartao de debito|Transferencia|Dinheiro|Outro|null",',
    '  "amount": number|null,',
    '  "paidAt": "YYYY-MM-DD"|null,',
    '  "payerName": string|null,',
    '  "receiverName": string|null,',
    '  "transactionId": string|null,',
    '  "confidence": number,',
    '  "warnings": string[]',
    "}",
    textHint ? `Texto/legenda recebido junto: ${textHint.slice(0, 1000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await geminiFilePrompt({
    apiKey,
    fileData: media.buffer,
    mimeType,
    prompt,
    temperature: 0.05,
    maxTokens: 700,
    jsonMode: true,
  });

  const parsed = parseJsonObject(result.content);
  if (!parsed || typeof parsed !== "object") return null;

  const amount = normalizeMoney(parsed.amount);
  return {
    isPaymentReceipt: Boolean(parsed.isPaymentReceipt),
    paymentMethod: normalizeMethod(parsed.paymentMethod) || String(parsed.paymentMethod || ""),
    amount,
    amountCandidates: amount ? [amount] : [],
    paidAt: parseDateOnly(parsed.paidAt),
    payerName: parsed.payerName || null,
    receiverName: parsed.receiverName || null,
    transactionId: parsed.transactionId || null,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0.65))),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    source: "gemini_file",
  };
}

function mergeReceiptAnalyses(textReceipt, mediaReceipt) {
  const amountCandidates = uniqueAmounts([
    ...(textReceipt?.amountCandidates || []),
    ...(mediaReceipt?.amountCandidates || []),
    textReceipt?.amount,
    mediaReceipt?.amount,
  ]);

  const preferredAmount = mediaReceipt?.amount || textReceipt?.amount || amountCandidates[0] || null;
  const isPaymentReceipt = Boolean(mediaReceipt?.isPaymentReceipt || textReceipt?.isPaymentReceipt);

  return {
    isPaymentReceipt,
    amount: preferredAmount,
    amountCandidates,
    paidAt: mediaReceipt?.paidAt || textReceipt?.paidAt || null,
    paymentMethod: mediaReceipt?.paymentMethod || textReceipt?.paymentMethod || "",
    payerName: mediaReceipt?.payerName || null,
    receiverName: mediaReceipt?.receiverName || null,
    transactionId: mediaReceipt?.transactionId || textReceipt?.transactionId || null,
    confidence: Math.max(textReceipt?.confidence || 0, mediaReceipt?.confidence || 0),
    sources: [textReceipt?.source, mediaReceipt?.source].filter(Boolean),
    warnings: mediaReceipt?.warnings || [],
  };
}

function amountMatch(receipt, expectedAmount) {
  const candidates = uniqueAmounts([receipt.amount, ...(receipt.amountCandidates || [])]);
  if (!candidates.length) return { score: 0, delta: Infinity, matchedAmount: null };

  const expected = toNumber(expectedAmount);
  const best = candidates.reduce(
    (acc, amount) => {
      const delta = Math.abs(amount - expected);
      return delta < acc.delta ? { delta, matchedAmount: amount } : acc;
    },
    { delta: Infinity, matchedAmount: null },
  );

  if (best.delta <= 0.02) return { ...best, score: 0.48 };
  if (expected > 0 && best.delta <= Math.max(1, expected * 0.02)) return { ...best, score: 0.24 };
  return { ...best, score: 0 };
}

function daysBetween(left, right) {
  const a = new Date(`${left}T12:00:00`);
  const b = new Date(`${right}T12:00:00`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return Infinity;
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
}

function scoreCandidate({ receipt, candidate, conversation, amountMatchesCount }) {
  const amount = amountMatch(receipt, candidate.amount);
  let score = 0;
  const reasons = [];

  if (receipt.isPaymentReceipt) {
    score += Math.min(0.2, (receipt.confidence || 0.55) * 0.2);
    reasons.push("arquivo parece comprovante");
  }

  if (conversation.customerId && String(candidate.appointment.customerId) === String(conversation.customerId)) {
    score += 0.18;
    reasons.push("cliente da conversa confere");
  }

  if (conversation.petId && String(candidate.appointment.petId) === String(conversation.petId)) {
    score += 0.05;
    reasons.push("pet da conversa confere");
  }

  if (amount.score > 0) {
    score += amount.score;
    reasons.push(`valor bate com R$ ${toNumber(candidate.amount).toFixed(2)}`);
  }

  if (receipt.paymentMethod) {
    score += 0.03;
    reasons.push(`metodo ${receipt.paymentMethod}`);
  }

  if (receipt.paidAt) {
    const dueDistance = daysBetween(receipt.paidAt, candidate.dueDate || candidate.appointment.date);
    const appointmentDistance = daysBetween(receipt.paidAt, candidate.appointment.date);
    const distance = Math.min(dueDistance, appointmentDistance);
    if (distance <= 3) {
      score += 0.06;
      reasons.push("data muito proxima");
    } else if (distance <= 14) {
      score += 0.03;
      reasons.push("data dentro da janela");
    }
  }

  if (amountMatchesCount === 1 && amount.score >= 0.48) {
    score += 0.04;
    reasons.push("unico pagamento com esse valor");
  }

  return {
    ...candidate,
    confidence: Number(Math.min(0.99, score).toFixed(3)),
    amountDelta: amount.delta,
    matchedReceiptAmount: amount.matchedAmount,
    reasons,
  };
}

async function loadCandidatePayments({ usersId, conversation, receipt }) {
  if (!usersId || !conversation?.customerId) return [];

  const center = receipt.paidAt
    ? new Date(`${receipt.paidAt}T12:00:00`)
    : new Date();
  const from = dateOnly(addDays(center, -45));
  const to = dateOnly(addDays(center, 90));

  const appointments = await Appointment.findAll({
    where: {
      usersId,
      customerId: conversation.customerId,
      date: { [Op.between]: [from, to] },
      status: { [Op.notIn]: ["Cancelado", "cancelado", "cancelada"] },
    },
    order: [
      ["date", "ASC"],
      ["time", "ASC"],
    ],
    limit: 80,
  });

  if (!appointments.length) return [];

  const appointmentIds = appointments.map((appointment) => appointment.id);
  const [items, payments] = await Promise.all([
    AppointmentItem.findAll({
      where: { usersId, appointmentId: { [Op.in]: appointmentIds } },
      order: [["createdAt", "ASC"]],
    }),
    AppointmentPayment.findAll({
      where: { usersId, appointmentId: { [Op.in]: appointmentIds } },
      order: [["dueDate", "ASC"], ["createdAt", "ASC"]],
    }),
  ]);

  const itemsByAppointment = new Map();
  for (const item of items) {
    const key = String(item.appointmentId);
    if (!itemsByAppointment.has(key)) itemsByAppointment.set(key, []);
    itemsByAppointment.get(key).push(item);
  }

  const paymentsByAppointment = new Map();
  for (const payment of payments) {
    const key = String(payment.appointmentId);
    if (!paymentsByAppointment.has(key)) paymentsByAppointment.set(key, []);
    paymentsByAppointment.get(key).push(payment);
  }

  const candidates = [];
  for (const appointment of appointments) {
    const appointmentPayments = paymentsByAppointment.get(String(appointment.id)) || [];
    const appointmentItems = itemsByAppointment.get(String(appointment.id)) || [];
    const summary = await calculateAppointmentSummary(appointment, appointmentItems, appointmentPayments);
    const pendingPayments = appointmentPayments.filter(
      (payment) => String(payment.status || "").toLowerCase() === "pendente",
    );

    for (const payment of pendingPayments) {
      const amount = toNumber(payment.grossAmount || payment.amount);
      if (amount <= 0) continue;
      candidates.push({
        kind: "existing_payment",
        appointment,
        payment,
        dueDate: payment.dueDate || appointment.date,
        amount,
        summary,
      });
    }

    if (!pendingPayments.length && toNumber(summary.balance) > 0) {
      candidates.push({
        kind: "appointment_balance",
        appointment,
        payment: null,
        dueDate: appointment.date,
        amount: toNumber(summary.balance),
        summary,
      });
    }
  }

  const amountMatchesCount = candidates.filter(
    (candidate) => amountMatch(receipt, candidate.amount).score >= 0.48,
  ).length;

  return candidates
    .map((candidate) =>
      scoreCandidate({ receipt, candidate, conversation, amountMatchesCount }),
    )
    .sort((a, b) => b.confidence - a.confidence);
}

function appendDetails(current, line) {
  return [String(current || "").trim(), line].filter(Boolean).join("\n");
}

function paidAtDate(receipt) {
  if (receipt?.paidAt) {
    const date = new Date(`${receipt.paidAt}T12:00:00`);
    if (Number.isFinite(date.getTime())) return date;
  }
  return new Date();
}

async function applyPaymentReceipt({ usersId, receipt, candidate, message, createdBy }) {
  const appointment = candidate.appointment;
  const actorId = createdBy || appointment.responsibleId || appointment.usersId || usersId;
  const method = receipt.paymentMethod || candidate.payment?.paymentMethod || "Pix";
  const paidAt = paidAtDate(receipt);
  const detailLine = [
    "Baixa automatica pelo CRM IA a partir de comprovante recebido.",
    `Mensagem CRM: ${message.id}.`,
    receipt.transactionId ? `Transacao: ${receipt.transactionId}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  let payment = candidate.payment;

  if (payment) {
    await payment.update({
      paymentMethod: method,
      status: "pago",
      paidAt,
      details: appendDetails(payment.details, detailLine),
    });
  } else {
    const breakdown = await resolveFeeBreakdownForMethod({
      usersId,
      grossAmount: candidate.matchedReceiptAmount || receipt.amount || candidate.amount,
      paymentMethod: method,
    });

    payment = await AppointmentPayment.create({
      appointmentId: appointment.id,
      usersId,
      dueDate: appointment.date,
      paymentMethod: method,
      details: detailLine,
      amount: breakdown.grossAmount,
      grossAmount: breakdown.grossAmount,
      feePercentage: breakdown.feePercentage,
      feeAmount: breakdown.feeAmount,
      netAmount: breakdown.netAmount,
      status: "pago",
      paidAt,
      createdBy: actorId,
    });
  }

  const summary = await syncAppointmentFinance(appointment.id);
  await logAppointmentEvent({
    appointmentId: appointment.id,
    usersId,
    createdBy: actorId,
    status: appointment.status,
    eventType: "payment_receipt_ai_confirmed",
    notes: `Comprovante confirmado automaticamente pelo CRM IA. Valor R$ ${toNumber(
      candidate.matchedReceiptAmount || candidate.amount,
    ).toFixed(2)}. Confianca ${(candidate.confidence * 100).toFixed(0)}%.`,
  });

  return { payment, summary };
}

async function saveReceiptState({ conversation, message, state }) {
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  await message.update({
    payload: {
      ...payload,
      receiptAutomation: {
        ...(payload.receiptAutomation || {}),
        ...state,
        updatedAt: new Date().toISOString(),
      },
    },
  });

  const metadata = conversation.metadata && typeof conversation.metadata === "object"
    ? conversation.metadata
    : {};
  await conversation.update({
    metadata: {
      ...metadata,
      paymentReceiptAutomation: {
        ...state,
        messageId: message.id,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

function buildAppliedReply(candidate) {
  const amount = toNumber(candidate.matchedReceiptAmount || candidate.amount).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  return `Recebi seu comprovante e ja marquei o pagamento de ${amount} no seu agendamento. Obrigado!`;
}

export async function processPaymentReceiptMessage({
  usersId,
  conversation,
  inboundMessage,
  createdBy = null,
} = {}) {
  if (!usersId || !conversation?.id || !inboundMessage?.id) {
    return { handled: false, reason: "dados_insuficientes" };
  }

  const existingState = inboundMessage.payload?.receiptAutomation;
  if (existingState?.autoApplied && existingState?.paymentId) {
    return {
      handled: true,
      autoApplied: true,
      alreadyApplied: true,
      reply: existingState.reply || "",
      reason: "comprovante_ja_processado",
    };
  }

  const textHint = collectMessageText(inboundMessage);
  const textReceipt = extractReceiptFromText(textHint);
  let mediaReceipt = null;

  try {
    mediaReceipt = await analyzeMediaWithGemini({
      usersId,
      message: inboundMessage,
      textHint,
    });
  } catch (error) {
    console.error("[CRM RECEIPT AI] Falha ao ler midia:", error?.message || error);
  }

  const receipt = mergeReceiptAnalyses(textReceipt, mediaReceipt);
  if (!receipt.isPaymentReceipt) {
    return {
      handled: false,
      reason: "midia_nao_identificada_como_comprovante",
      receipt,
    };
  }

  if (!conversation.customerId) {
    const state = {
      status: "needs_review",
      reason: "cliente_nao_vinculado",
      receipt,
      autoApplied: false,
    };
    await saveReceiptState({ conversation, message: inboundMessage, state });
    return {
      handled: true,
      autoApplied: false,
      needsReview: true,
      reason: "cliente_nao_vinculado",
      summary: "Comprovante recebido, mas a conversa ainda nao esta vinculada a um cliente.",
      receipt,
    };
  }

  if (!receipt.amount && !receipt.amountCandidates?.length) {
    const state = {
      status: "needs_review",
      reason: "valor_nao_identificado",
      receipt,
      autoApplied: false,
    };
    await saveReceiptState({ conversation, message: inboundMessage, state });
    return {
      handled: true,
      autoApplied: false,
      needsReview: true,
      reason: "valor_nao_identificado",
      summary: "Comprovante recebido, mas o valor nao foi identificado com seguranca.",
      receipt,
    };
  }

  const candidates = await loadCandidatePayments({ usersId, conversation, receipt });
  const best = candidates[0] || null;
  const second = candidates[1] || null;
  const isAmbiguous = best && second && best.confidence - second.confidence < AMBIGUITY_MARGIN;

  if (!best || best.confidence < AUTO_APPLY_THRESHOLD || isAmbiguous) {
    const state = {
      status: "needs_review",
      reason: !best
        ? "pagamento_pendente_nao_encontrado"
        : isAmbiguous
          ? "mais_de_um_agendamento_possivel"
          : "confianca_insuficiente",
      receipt,
      candidates: candidates.slice(0, 5).map((candidate) => ({
        kind: candidate.kind,
        appointmentId: candidate.appointment.id,
        paymentId: candidate.payment?.id || null,
        amount: candidate.amount,
        dueDate: candidate.dueDate,
        confidence: candidate.confidence,
        reasons: candidate.reasons,
      })),
      autoApplied: false,
    };
    await saveReceiptState({ conversation, message: inboundMessage, state });
    return {
      handled: true,
      autoApplied: false,
      needsReview: true,
      reason: state.reason,
      summary: "Comprovante recebido, mas precisa de revisao antes da baixa.",
      receipt,
      candidates,
    };
  }

  const applied = await applyPaymentReceipt({
    usersId,
    receipt,
    candidate: best,
    message: inboundMessage,
    createdBy,
  });
  const reply = buildAppliedReply(best);

  await saveReceiptState({
    conversation,
    message: inboundMessage,
    state: {
      status: "auto_applied",
      reason: "alta_confianca",
      receipt,
      autoApplied: true,
      appointmentId: best.appointment.id,
      paymentId: applied.payment.id,
      confidence: best.confidence,
      reply,
    },
  });

  return {
    handled: true,
    autoApplied: true,
    needsReview: false,
    reason: "pagamento_baixado",
    summary: "Pagamento baixado automaticamente pelo comprovante recebido.",
    receipt,
    candidate: best,
    payment: applied.payment,
    reply,
  };
}

export const CRM_RECEIPT_AUTO_APPLY_THRESHOLD = AUTO_APPLY_THRESHOLD;
