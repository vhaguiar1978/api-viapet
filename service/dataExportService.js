import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Op } from "sequelize";
import XLSX from "xlsx";
import DataExportJob from "../models/DataExportJob.js";
import Users from "../models/Users.js";
import Custumers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import Appointment from "../models/Appointment.js";
import AppointmentItem from "../models/AppointmentItem.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import AppointmentStatusHistory from "../models/AppointmentStatusHistory.js";
import Services from "../models/Services.js";
import Finance from "../models/Finance.js";
import CashClosure from "../models/CashClosure.js";
import CashRegisterSession from "../models/CashRegisterSession.js";
import CashRegisterMovement from "../models/CashRegisterMovement.js";
import Products from "../models/Products.js";
import PurchaseItems from "../models/PurchaseItems.js";
import SaleItem from "../models/SaleItem.js";
import TransportJob from "../models/TransportJob.js";
import CrmConversation from "../models/CrmConversation.js";

export const EXPORT_STATUSES = ["REQUESTED", "QUEUED", "PROCESSING", "GENERATING_FILE", "READY", "FAILED", "EXPIRED"];
const PRIVATE_ROOT = path.resolve(process.env.DATA_EXPORT_STORAGE_DIR || ".private-data-exports");
const SENSITIVE_FIELD = /password|token|secret|credential|api.?key|hash|webhook|metadata|deviceInfo|attachment/i;

export function safeExportAttributes(model, extraBlocked = []) {
  const blocked = new Set(["usersId", ...extraBlocked]);
  return Object.keys(model.rawAttributes).filter((key) => !blocked.has(key) && !SENSITIVE_FIELD.test(key));
}

export function hashDownloadToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function canAccessExport(job, user) {
  return Boolean(job && user && String(job.usersId) === String(user.establishment));
}

function cleanValue(value) {
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

async function readTenantRows(model, usersId, { where = {}, attributes, order = [["createdAt", "ASC"]] } = {}) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await model.findAll({
      where: { ...where, usersId }, attributes: attributes || safeExportAttributes(model), order,
      limit: pageSize, offset, raw: true,
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

const LABELS = {
  id: "Identificação", name: "Nome", phone: "Telefone", email: "E-mail", birthDate: "Nascimento",
  birthdate: "Nascimento", createdAt: "Data de cadastro", updatedAt: "Última atualização", observation: "Observações",
  status: "Situação", date: "Data", dueDate: "Vencimento", amount: "Valor", paymentMethod: "Forma de pagamento",
  description: "Descrição", category: "Categoria", subCategory: "Subcategoria", price: "Preço", cost: "Custo",
  stoke: "Estoque", openedAt: "Abertura", closedAt: "Fechamento", openingAmount: "Valor de abertura",
};

function appendSheet(workbook, name, rows, { title, note } = {}) {
  const normalizedRows = rows.length ? rows : [{ Situação: "Nenhum registro disponível" }];
  const keys = [...new Set(normalizedRows.flatMap((row) => Object.keys(row)))];
  const heading = keys.map((key) => LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()));
  const data = normalizedRows.map((row) => keys.map((key) => cleanValue(row[key])));
  const aoa = title ? [[title], ...(note ? [[note]] : []), [], heading, ...data] : [heading, ...data];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const headerRow = title ? (note ? 3 : 2) : 0;
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: Math.max(headerRow, headerRow + data.length), c: Math.max(0, keys.length - 1) } }) };
  sheet["!freeze"] = { xSplit: 0, ySplit: headerRow + 1 };
  sheet["!cols"] = keys.map((key) => ({ wch: Math.min(42, Math.max(13, String(LABELS[key] || key).length + 3)) }));
  keys.forEach((key, columnIndex) => {
    const isDate = /date|At$|nascimento|vencimento/i.test(key);
    const isMoney = /amount|price|cost|total|balance|valor|desconto|acrescimo/i.test(key);
    for (let rowIndex = headerRow + 1; rowIndex < headerRow + 1 + data.length; rowIndex += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (!cell) continue;
      if (isDate && cell.t === "d") cell.z = "dd/mm/yyyy hh:mm";
      if (isMoney && cell.t === "n") cell.z = 'R$ #,##0.00';
    }
  });
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
  return rows.length;
}

function sanitizeCompanyName(value) {
  return String(value || "Empresa").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
}

export async function generateTenantExport(job) {
  const usersId = job.usersId;
  const owner = await Users.findByPk(usersId, { attributes: ["id", "name", "email", "createdAt"], raw: true });
  if (!owner) throw new Error("Empresa da exportação não encontrada.");

  await job.update({ status: "PROCESSING", startedAt: new Date(), errorCode: null, errorMessage: null });
  const [customers, pets, appointments, appointmentItems, payments, histories, services, finances, closures, sessions, movements, products, purchases, saleItems, transports, crm, employees] = await Promise.all([
    readTenantRows(Custumers, usersId), readTenantRows(Pets, usersId), readTenantRows(Appointment, usersId),
    readTenantRows(AppointmentItem, usersId), readTenantRows(AppointmentPayment, usersId), readTenantRows(AppointmentStatusHistory, usersId),
    readTenantRows(Services, usersId), readTenantRows(Finance, usersId), readTenantRows(CashClosure, usersId),
    readTenantRows(CashRegisterSession, usersId, { attributes: safeExportAttributes(CashRegisterSession, ["deviceInfo"]) }),
    readTenantRows(CashRegisterMovement, usersId, { attributes: safeExportAttributes(CashRegisterMovement, ["metadata", "attachmentUrl"]) }),
    readTenantRows(Products, usersId, { attributes: safeExportAttributes(Products, ["imageUrl"]) }), readTenantRows(PurchaseItems, usersId),
    readTenantRows(SaleItem, usersId), readTenantRows(TransportJob, usersId),
    readTenantRows(CrmConversation, usersId, { attributes: safeExportAttributes(CrmConversation, ["metadata", "collectedFields", "missingFields", "avatarUrl"]) }),
    Users.findAll({ where: { establishment: usersId, role: "funcionario" }, attributes: ["id", "name", "email", "role", "status", "observation", "createdAt", "updatedAt"], raw: true }),
  ]);

  await job.update({ status: "GENERATING_FILE" });
  const wb = XLSX.utils.book_new();
  const sections = [
    ["Clientes", customers], ["Pets", pets], ["Agenda", appointments], ["Serviços realizados", appointmentItems],
    ["Pagamentos", payments], ["Histórico agenda", histories], ["Serviços", services], ["Pacotes", appointments.filter((row) => row.packageGroupId || row.packageId)],
    ["Financeiro", finances], ["Mov. financeiras", histories], ["Caixa", [...sessions, ...closures, ...movements]],
    ["Produtos", products], ["Estoque", [...purchases, ...saleItems]], ["Táxi Dog", transports], ["Colaboradores", employees], ["CRM", crm],
  ];
  const recordCount = sections.reduce((sum, [, rows]) => sum + rows.length, 0);
  appendSheet(wb, "Informações do backup", [{
    "Nome da empresa": owner.name, "Identificação da empresa": owner.id, "Data da geração": new Date(),
    "Período dos dados": "Todo o histórico disponível", "Versão da exportação": "1.0",
    "Quantidade de clientes": customers.length, "Quantidade de pets": pets.length,
    "Quantidade de agendamentos": appointments.length, "Movimentações financeiras": finances.length,
    "Total de registros": recordCount,
  }], { title: "Backup de dados ViaPet", note: "Este arquivo contém uma cópia dos dados da sua empresa armazenados no ViaPet." });
  sections.forEach(([name, rows]) => appendSheet(wb, name, rows));

  await fs.mkdir(PRIVATE_ROOT, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `Backup_ViaPet_${sanitizeCompanyName(owner.name)}_${date}.xlsx`;
  const storageKey = path.join(String(usersId), `${job.id}.xlsx`);
  const absolutePath = path.resolve(PRIVATE_ROOT, storageKey);
  if (!absolutePath.startsWith(`${PRIVATE_ROOT}${path.sep}`)) throw new Error("Destino privado inválido.");
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  XLSX.writeFile(wb, absolutePath, { compression: true, cellDates: true, cellStyles: true });
  const stat = await fs.stat(absolutePath);
  await job.update({ status: "READY", fileName, storageKey, fileSize: stat.size, recordCount, finishedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000) });
}

let workerRunning = false;
export async function processNextDataExport() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await DataExportJob.update(
      { status: "QUEUED", errorCode: "WORKER_INTERRUPTED", errorMessage: "Processamento retomado automaticamente após interrupção." },
      { where: { status: { [Op.in]: ["PROCESSING", "GENERATING_FILE"] }, startedAt: { [Op.lt]: new Date(Date.now() - 30 * 60000) } } },
    );
    const job = await DataExportJob.findOne({ where: { status: { [Op.in]: ["REQUESTED", "QUEUED"] } }, order: [["createdAt", "ASC"]] });
    if (!job) return;
    const [claimed] = await DataExportJob.update(
      { status: "PROCESSING", startedAt: new Date() },
      { where: { id: job.id, status: { [Op.in]: ["REQUESTED", "QUEUED"] } }, fields: ["status", "startedAt"] },
    );
    if (!claimed) return;
    await job.reload();
    try { await generateTenantExport(job); }
    catch (error) { await job.update({ status: "FAILED", finishedAt: new Date(), errorCode: "GENERATION_FAILED", errorMessage: String(error?.message || error).slice(0, 2000) }); }
  } finally { workerRunning = false; }
}

export async function expireDataExports() {
  const jobs = await DataExportJob.findAll({ where: { status: "READY", expiresAt: { [Op.lt]: new Date() } } });
  for (const job of jobs) {
    if (job.storageKey) {
      const target = path.resolve(PRIVATE_ROOT, job.storageKey);
      if (target.startsWith(`${PRIVATE_ROOT}${path.sep}`)) await fs.rm(target, { force: true }).catch(() => {});
    }
    await job.update({ status: "EXPIRED", downloadTokenHash: null, downloadTokenExpiresAt: null });
  }
}

export function resolvePrivateExportPath(storageKey) {
  const target = path.resolve(PRIVATE_ROOT, String(storageKey || ""));
  return target.startsWith(`${PRIVATE_ROOT}${path.sep}`) ? target : null;
}
