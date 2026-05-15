// Parsers para extratos bancários: OFX, CSV e Excel.
// Cada parser retorna um array de entries normalizadas no formato:
// { entryDate: "YYYY-MM-DD", direction: "credit"|"debit", amount: number,
//   description, payerName?, payerDocument?, externalId?, paymentMethodHint?, rawJson }

import { parse as parseOfx } from "ofx-js";
import Papa from "papaparse";
import * as XLSX from "xlsx";

// ---------- helpers ----------

function normalizeNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const raw = String(v).trim();
  if (!raw) return null;
  // Brasil: "1.234,56" ou "-1.234,56". US: "1234.56". Limpa simbolos.
  const cleaned = raw
    .replace(/[^\d,.\-]/g, "")
    .replace(/\.(?=\d{3}(?:[,.]|$))/g, "") // remove pontos como separador de milhar
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeDate(v) {
  if (!v) return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  const s = String(v).trim();
  // OFX: YYYYMMDD[HHMMSS][.XXX][TZ]
  if (/^\d{8}/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD/MM/YYYY ou DD-MM-YYYY
  m = s.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Excel serial number (~25000-60000 range for typical dates)
  const num = Number(s);
  if (Number.isFinite(num) && num > 25569 && num < 80000) {
    const ms = (num - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  return null;
}

const STRIP_DIACRITICS = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function inferPaymentMethod(description = "") {
  const s = STRIP_DIACRITICS(description);
  if (/\bpix\b/.test(s)) return "pix";
  if (/\bted\b/.test(s)) return "ted";
  if (/\bdoc\b/.test(s)) return "doc";
  if (/boleto/.test(s)) return "boleto";
  if (/cartao|debito|credito/.test(s)) return "cartao";
  if (/transfer/.test(s)) return "transferencia";
  if (/saque/.test(s)) return "saque";
  if (/deposito/.test(s)) return "deposito";
  return null;
}

const CPF_RE = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/;
const CNPJ_RE = /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/;

function extractDocument(description = "") {
  const cnpj = String(description).match(CNPJ_RE);
  if (cnpj) return cnpj[1].replace(/\D/g, "");
  const cpf = String(description).match(CPF_RE);
  if (cpf) return cpf[1].replace(/\D/g, "");
  return null;
}

// Tenta extrair nome do pagador de descricoes tipo "PIX RECEBIDO - JOAO DA SILVA"
function extractPayerName(description = "") {
  const s = String(description).trim();
  // Padroes comuns em extratos brasileiros
  const patterns = [
    /pix\s+receb[a-z]*\s*[-:]?\s*(.+?)(?:\s+cpf|\s+cnpj|\s+ag\b|\s+banco|$)/i,
    /pix\s+enviado\s*[-:]?\s*(.+?)(?:\s+cpf|\s+cnpj|\s+ag\b|\s+banco|$)/i,
    /transfer[eê]ncia\s+(?:de|para)\s+(.+?)(?:\s+cpf|\s+cnpj|\s+ag\b|\s+banco|$)/i,
    /ted\s*[-:]?\s*(.+?)(?:\s+cpf|\s+cnpj|\s+ag\b|\s+banco|$)/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m && m[1]) {
      const candidate = m[1].trim().replace(/\s+/g, " ").slice(0, 180);
      if (candidate.length >= 2 && !/^\d+$/.test(candidate)) return candidate;
    }
  }
  return null;
}

// ---------- OFX ----------
export async function parseOfxBuffer(buffer) {
  const text = buffer.toString("utf8");
  const json = await parseOfx(text);
  // Estrutura OFX típica: OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS.BANKTRANLIST.STMTTRN
  const trnRoot =
    json?.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS?.BANKTRANLIST?.STMTTRN ??
    json?.OFX?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS?.BANKTRANLIST?.STMTTRN ??
    [];
  const trnList = Array.isArray(trnRoot) ? trnRoot : [trnRoot];

  return trnList
    .map((trn) => {
      const amount = normalizeNumber(trn.TRNAMT);
      if (amount == null) return null;
      const desc = String(trn.MEMO || trn.NAME || "").trim();
      return {
        entryDate: normalizeDate(trn.DTPOSTED),
        direction: amount >= 0 ? "credit" : "debit",
        amount: Math.abs(amount),
        description: desc,
        payerName: extractPayerName(desc) || (trn.NAME ? String(trn.NAME).slice(0, 180) : null),
        payerDocument: extractDocument(desc),
        externalId: trn.FITID ? String(trn.FITID).slice(0, 120) : null,
        paymentMethodHint: inferPaymentMethod(desc + " " + (trn.TRNTYPE || "")),
        rawJson: trn,
      };
    })
    .filter(Boolean)
    .filter((e) => e.entryDate);
}

// ---------- CSV ----------
// Aceita headers variados: date/data, description/descricao/historico, value/valor, type/tipo,
// document/cpf, etc. Detecta direction por sinal do valor ou colunas separadas credito/debito.
export function parseCsvBuffer(buffer) {
  const text = buffer.toString("utf8");
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => STRIP_DIACRITICS(String(h || "").trim()),
  });
  const rows = parsed.data || [];
  return rows
    .map((row) => parseStatementRow(row))
    .filter(Boolean);
}

// ---------- Excel (xls/xlsx) ----------
export function parseXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return rows
    .map((row) => {
      const normalized = {};
      for (const k of Object.keys(row)) normalized[STRIP_DIACRITICS(k.trim())] = row[k];
      return parseStatementRow(normalized);
    })
    .filter(Boolean);
}

// Linha generica (CSV/Excel) → entry normalizada
function parseStatementRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return null;
  };

  const entryDate = normalizeDate(
    get("data", "date", "dt", "dt mov", "data mov", "data movimento", "data lancamento"),
  );
  if (!entryDate) return null;

  const description = String(
    get("descricao", "description", "historico", "memo", "obs", "observacao") || "",
  ).trim();

  let amount = normalizeNumber(get("valor", "value", "amount", "vlr", "vl"));
  let direction = null;

  // Colunas separadas credito/debito
  const credit = normalizeNumber(get("credito", "credit", "entrada", "receita"));
  const debit = normalizeNumber(get("debito", "debit", "saida", "despesa"));
  if (credit != null && credit > 0) {
    direction = "credit";
    amount = credit;
  } else if (debit != null && debit > 0) {
    direction = "debit";
    amount = debit;
  } else if (amount != null) {
    direction = amount >= 0 ? "credit" : "debit";
    amount = Math.abs(amount);
  }

  if (amount == null || direction == null) return null;

  // Tipo explicito ("C"/"D" ou "credito"/"debito")
  const tipo = STRIP_DIACRITICS(get("tipo", "type", "natureza") || "");
  if (tipo === "c" || tipo.includes("credit") || tipo.includes("entr")) direction = "credit";
  else if (tipo === "d" || tipo.includes("debit") || tipo.includes("said")) direction = "debit";

  const docFromColumn = String(get("cpf", "cnpj", "documento", "doc") || "").replace(/\D/g, "") || null;

  return {
    entryDate,
    direction,
    amount,
    description,
    payerName: String(get("nome", "pagador", "favorecido", "contraparte") || extractPayerName(description) || "").slice(0, 180) || null,
    payerDocument: docFromColumn || extractDocument(description),
    externalId: get("id", "fitid", "transacao") ? String(get("id", "fitid", "transacao")).slice(0, 120) : null,
    paymentMethodHint: inferPaymentMethod(description),
    rawJson: row,
  };
}

// ---------- dispatcher ----------
export async function parseStatementBuffer({ buffer, fileName, mimeType }) {
  const name = String(fileName || "").toLowerCase();
  const mt = String(mimeType || "").toLowerCase();

  if (name.endsWith(".ofx") || mt.includes("ofx") || mt.includes("x-ofx")) {
    return { sourceType: "ofx", entries: await parseOfxBuffer(buffer) };
  }
  if (name.endsWith(".csv") || mt.includes("csv") || mt.includes("text/plain")) {
    return { sourceType: "csv", entries: parseCsvBuffer(buffer) };
  }
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    mt.includes("spreadsheet") ||
    mt.includes("excel")
  ) {
    return { sourceType: "xlsx", entries: parseXlsxBuffer(buffer) };
  }
  // Fallback: tenta OFX → CSV → Excel
  try {
    return { sourceType: "ofx", entries: await parseOfxBuffer(buffer) };
  } catch {}
  try {
    const csv = parseCsvBuffer(buffer);
    if (csv.length) return { sourceType: "csv", entries: csv };
  } catch {}
  try {
    return { sourceType: "xlsx", entries: parseXlsxBuffer(buffer) };
  } catch {}
  return { sourceType: "unknown", entries: [] };
}

export const helpers = {
  normalizeNumber,
  normalizeDate,
  inferPaymentMethod,
  extractDocument,
  extractPayerName,
  STRIP_DIACRITICS,
};
