import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const PaymentMethodFee = sequelize.define(
  "PaymentMethodFee",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    method: {
      type: DataTypes.STRING(40),
      allowNull: false,
      comment: "Chave normalizada: dinheiro, pix, debito, credito_avista, credito_parcelado, transferencia, outros",
    },
    label: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    feePercent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    },
    feeFixed: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "payment_method_fees",
    timestamps: true,
    indexes: [
      {
        name: "uq_payment_method_fees_user_method",
        unique: true,
        fields: ["usersId", "method"],
      },
      {
        name: "idx_payment_method_fees_user",
        fields: ["usersId"],
      },
    ],
  },
);

export const DEFAULT_PAYMENT_METHODS = [
  { method: "dinheiro", label: "Dinheiro", feePercent: 0, feeFixed: 0, sortOrder: 1 },
  { method: "pix", label: "Pix", feePercent: 0, feeFixed: 0, sortOrder: 2 },
  { method: "debito", label: "Débito", feePercent: 0, feeFixed: 0, sortOrder: 3 },
  { method: "credito_avista", label: "Crédito à vista", feePercent: 0, feeFixed: 0, sortOrder: 4 },
  { method: "credito_parcelado", label: "Crédito parcelado", feePercent: 0, feeFixed: 0, sortOrder: 5 },
  { method: "transferencia", label: "Transferência", feePercent: 0, feeFixed: 0, sortOrder: 6 },
  { method: "outros", label: "Outros", feePercent: 0, feeFixed: 0, sortOrder: 7 },
];

const METHOD_ALIASES = {
  dinheiro: ["dinheiro", "cash", "especie", "espécie"],
  pix: ["pix"],
  debito: ["debito", "débito", "debit", "cartao de debito", "cartão de débito"],
  credito_avista: [
    "credito_avista",
    "credito a vista",
    "crédito à vista",
    "cartao de credito a vista",
    "cartão de crédito à vista",
    "credito avista",
    "crédito avista",
  ],
  credito_parcelado: [
    "credito_parcelado",
    "credito parcelado",
    "crédito parcelado",
    "cartao parcelado",
    "cartão parcelado",
    "parcelado",
  ],
  transferencia: ["transferencia", "transferência", "ted", "doc", "transfer"],
  outros: ["outros", "outro", "other"],
};

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function normalizePaymentMethodKey(rawMethod, { hasInstallments = false } = {}) {
  const normalized = stripDiacritics(rawMethod);
  if (!normalized) return "outros";

  for (const [key, aliases] of Object.entries(METHOD_ALIASES)) {
    if (aliases.some((alias) => stripDiacritics(alias) === normalized)) {
      return key;
    }
  }

  if (normalized.includes("credito") || normalized.includes("crédito") || normalized.includes("cartao") || normalized.includes("cartão")) {
    if (hasInstallments || normalized.includes("parcel")) return "credito_parcelado";
    return "credito_avista";
  }
  if (normalized.includes("debit")) return "debito";
  if (normalized.includes("pix")) return "pix";
  if (normalized.includes("dinheir") || normalized.includes("especi")) return "dinheiro";
  if (normalized.includes("transfer") || normalized.includes("ted") || normalized.includes("doc")) return "transferencia";

  return "outros";
}

export function computeBreakdown(grossAmount, feePercent = 0, feeFixed = 0) {
  const gross = Number(grossAmount) || 0;
  const percent = Number(feePercent) || 0;
  const fixed = Number(feeFixed) || 0;
  const percentPart = Math.round(gross * percent) / 100;
  const feeAmount = Number((percentPart + fixed).toFixed(2));
  const netAmount = Number((gross - feeAmount).toFixed(2));
  return {
    grossAmount: Number(gross.toFixed(2)),
    feePercentage: Number(percent.toFixed(2)),
    feeFixed: Number(fixed.toFixed(2)),
    feeAmount,
    netAmount,
  };
}

export default PaymentMethodFee;
