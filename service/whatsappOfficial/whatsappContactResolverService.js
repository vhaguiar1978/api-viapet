import { Op } from "sequelize";
import Custumers from "../../models/Custumers.js";
import Pets from "../../models/Pets.js";
import { normalizePhone, phoneVariations } from "./phone.js";

export async function resolveCustomerAndPet({
  companyId,
  fromPhone,
}) {
  const normalized = normalizePhone(fromPhone);
  const variants = phoneVariations(fromPhone);
  const customer = await Custumers.findOne({
    where: {
      usersId: companyId,
      phone: {
        [Op.in]: variants,
      },
    },
    order: [
      ["updatedAt", "DESC"],
      ["createdAt", "DESC"],
    ],
  });

  const pet = customer
    ? await Pets.findOne({
        where: {
          usersId: companyId,
          custumerId: customer.id,
        },
        order: [
          ["updatedAt", "DESC"],
          ["createdAt", "DESC"],
        ],
      })
    : null;

  return {
    phone: normalized,
    customer,
    pet,
  };
}

export function buildProvisionalLeadName(contactName, phone) {
  const safeName = String(contactName || "").trim();
  if (safeName) return safeName;
  if (!phone) return "Lead sem nome";
  return `Lead ${phone}`;
}
