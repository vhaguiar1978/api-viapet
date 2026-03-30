import { Op } from "sequelize";
import Services from "../models/Services.js";

export const DEFAULT_EXAM_SERVICE_NAMES = [
  "Bacteriológico",
  "Bioquímico",
  "Bioquímico Cão",
  "Bioquímico Gato",
  "Ecografia",
  "Funcional de Amostra Fecal",
  "Hemograma",
  "Hemograma Cão",
  "Hemograma Gato",
  "Parasitológico de Fezes",
  "Parasitológico de Pele",
  "Qualitativo de Urina",
  "RX",
  "Sorológico",
];

export const DEFAULT_VACCINE_SERVICE_NAMES = [
  "Antirrábica",
  "Giardia",
  "Gripe",
  "Leishmaniose",
  "Leptospirose",
  "Polivalente",
  "Quádrupla",
  "Quíntupla",
  "Tríplice",
];

function normalizeKey(category, name) {
  return `${String(category || "").trim().toLowerCase()}::${String(name || "")
    .trim()
    .toLowerCase()}`;
}

export function buildDefaultMedicalCatalog(establishmentId) {
  const shared = {
    establishment: establishmentId,
    duration: null,
    cost: 0,
    price: 0,
  };

  return [
    ...DEFAULT_EXAM_SERVICE_NAMES.map((name) => ({
      ...shared,
      name,
      category: "Exames",
      description: "",
      observation: "Setor: Exames",
    })),
    ...DEFAULT_VACCINE_SERVICE_NAMES.map((name) => ({
      ...shared,
      name,
      category: "Vacinas",
      description: "",
      observation: "",
    })),
  ];
}

export async function ensureDefaultMedicalCatalog(
  establishmentId,
  options = {},
) {
  if (!establishmentId) {
    return [];
  }

  const defaults = buildDefaultMedicalCatalog(establishmentId);
  const existing = await Services.findAll({
    where: {
      establishment: establishmentId,
      category: {
        [Op.in]: ["Exames", "Vacinas"],
      },
    },
    attributes: ["name", "category"],
    transaction: options.transaction,
  });

  const existingKeys = new Set(
    existing.map((item) => normalizeKey(item.category, item.name)),
  );
  const missing = defaults.filter(
    (item) => !existingKeys.has(normalizeKey(item.category, item.name)),
  );

  if (!missing.length) {
    return [];
  }

  return Services.bulkCreate(missing, {
    transaction: options.transaction,
  });
}
