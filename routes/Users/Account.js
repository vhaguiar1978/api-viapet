import express from "express";
import authenticate from "../../middlewares/auth.js";
import Users from "../../models/Users.js";
import Settings from "../../models/Settings.js";
import Subscription from "../../models/Subscription.js";
import PaymentHistory from "../../models/PaymentHistory.js";
import bcrypt from "bcrypt";
import LoginHistory from "../../models/LoginHistory.js";
import jwt from "jsonwebtoken";
import { Op } from "sequelize";
import { createPixPayment } from "../../service/mercadopago.js";
import { buildBillingProfile, getOrCreateBillingSettings } from "../../service/billingAccess.js";
const router = express.Router();

router.get("/account", authenticate, async (req, res) => {
  try {
    const ownerId =
      req.user.role === "funcionario" && req.user.establishment
        ? req.user.establishment
        : req.user.id;
    const user = await Users.findByPk(req.user.id, {
      attributes: ["id", "name", "email", "role", "plan", "expirationDate"],
    });
    const establishmentUser = await Users.findByPk(ownerId, {
      attributes: ["id", "plan", "expirationDate", "name", "email"],
    });
    const establishment = await Settings.findOne({
      where: { usersId: ownerId },
    });
    const [billingSettings, latestSubscription] = await Promise.all([
      getOrCreateBillingSettings(),
      Subscription.findOne({
        where: { user_id: ownerId },
        order: [["created_at", "DESC"]],
      }),
    ]);

    if (establishmentUser) {
      user.setDataValue("plan", establishmentUser.plan);
      user.setDataValue("expirationDate", establishmentUser.expirationDate);
      user.setDataValue("establishmentOwnerId", establishmentUser.id);
      user.setDataValue("establishmentOwnerName", establishmentUser.name);
      user.setDataValue("establishmentOwnerEmail", establishmentUser.email);
    }

    if (establishment) {
      if (establishment.storeName) {
        user.setDataValue("storeName", establishment.storeName);
      }
      if (establishment.logoUrl) {
        user.setDataValue("logoUrl", establishment.logoUrl);
      }
      if (establishment.themeColor) {
        user.setDataValue("themeColor", establishment.themeColor);
      }
      if (establishment.textColor) {
        user.setDataValue("textColor", establishment.textColor);
      }
      if (establishment.usersId) {
        user.setDataValue("id", establishment.usersId);
      }
    }
    const billingProfile = buildBillingProfile(
      establishmentUser || user,
      latestSubscription,
      billingSettings,
    );
    user.setDataValue("billingProfile", billingProfile);
    return res.status(200).json(user);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao buscar informações do usuário",
      error: error.message,
    });
  }
});

router.post("/changepassword", authenticate, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        message: "Senha é obrigatória",
      });
    }

    // Generate salt and hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Update user password
    await Users.update(
      { password: hashedPassword },
      { where: { id: req.user.id } },
    );

    return res.status(200).json({
      message: "Senha atualizada com sucesso",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao atualizar senha",
      error: error.message,
    });
  }
});

router.get("/role", authenticate, async (req, res) => {
  const user = await Users.findByPk(req.user.id, { attributes: ["role"] });
  return res.status(200).json({ role: user.role });
});

router.post("/account/billing/pix", authenticate, async (req, res) => {
  try {
    const ownerId =
      req.user.role === "funcionario" && req.user.establishment
        ? req.user.establishment
        : req.user.id;

    const ownerUser = await Users.findByPk(ownerId, {
      attributes: ["id", "name", "email", "plan", "expirationDate", "status"],
    });

    if (!ownerUser) {
      return res.status(404).json({
        message: "Conta principal nao encontrada para gerar a cobranca.",
      });
    }

    const settings = await getOrCreateBillingSettings();
    if (!settings.mercadoPagoEnabled) {
      return res.status(400).json({
        message: "A cobranca por PIX esta desativada no admin.",
      });
    }

    const latestSubscription = await Subscription.findOne({
      where: { user_id: ownerId },
      order: [["created_at", "DESC"]],
    });

    const billingProfile = buildBillingProfile(
      ownerUser,
      latestSubscription,
      settings,
    );

    if (billingProfile.stage === "free") {
      return res.status(400).json({
        message:
          "Esta conta esta liberada sem custo. Nao ha cobranca pendente para gerar.",
      });
    }

    let subscription = await Subscription.findOne({
      where: {
        user_id: ownerId,
        status: {
          [Op.in]: ["pending", "active", "expired", "cancelled", "suspended"],
        },
      },
      order: [["created_at", "DESC"]],
    });

    const externalReference = `main_pix_${ownerId}_${Date.now()}`;
    const amount = Number(billingProfile.nextChargeAmount || 0);
    const planType = billingProfile.nextChargePlanType;

    const pixCharge = await createPixPayment({
      user: {
        id: ownerUser.id,
        name: ownerUser.name,
        email: ownerUser.email,
      },
      planType,
      amount,
      description:
        planType === "promotional"
          ? `Cobranca promocional do ViaPet por R$ ${amount
              .toFixed(2)
              .replace(".", ",")}`
          : `Cobranca mensal do ViaPet por R$ ${amount
              .toFixed(2)
              .replace(".", ",")}`,
      externalReference,
      notificationUrl: `${process.env.API_URL}/api/subscriptions/webhook`,
    });

    if (!pixCharge.success) {
      return res.status(400).json({
        message: "Nao foi possivel gerar o codigo PIX agora.",
        error: pixCharge.error,
      });
    }

    const cycleStart =
      ownerUser.expirationDate &&
      new Date(ownerUser.expirationDate) > new Date()
        ? new Date(ownerUser.expirationDate)
        : new Date();
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setDate(cycleEnd.getDate() + 30);

    if (!subscription) {
      subscription = await Subscription.create({
        user_id: ownerId,
        plan_type: planType,
        status: "pending",
        payment_status: pixCharge.status || "pending",
        amount,
        currency: "BRL",
        payment_id: String(pixCharge.id || ""),
        payment_method: "pix",
        next_billing_date: cycleEnd,
        notes: "Cobranca PIX gerada pelo proprio usuario",
      });
    } else {
      await subscription.update({
        plan_type: planType,
        status: "pending",
        payment_status: pixCharge.status || "pending",
        amount,
        currency: "BRL",
        payment_id: String(pixCharge.id || ""),
        payment_method: "pix",
        next_billing_date: cycleEnd,
        notes: "Cobranca PIX gerada pelo proprio usuario",
      });
    }

    await PaymentHistory.create({
      subscription_id: subscription.id,
      user_id: ownerId,
      payment_id: String(pixCharge.id || ""),
      external_reference: externalReference,
      status:
        ["pending", "approved", "authorized", "in_process", "in_mediation", "rejected", "cancelled", "refunded", "charged_back"].includes(
          String(pixCharge.status || "pending"),
        )
          ? String(pixCharge.status || "pending")
          : "pending",
      amount,
      currency: "BRL",
      payment_method: "pix",
      payment_type: "pix",
      installments: 1,
      date_created: new Date(),
      date_last_updated: new Date(),
      billing_period_start: cycleStart,
      billing_period_end: cycleEnd,
      plan_type: planType,
      is_trial: false,
      notes: "PIX gerado no autoatendimento do usuario",
    });

    return res.json({
      message: "Codigo PIX gerado com sucesso.",
      data: {
        amount,
        planType,
        stage: billingProfile.stage,
        expirationDate: ownerUser.expirationDate,
        qrCode: pixCharge.qrCode,
        qrCodeBase64: pixCharge.qrCodeBase64,
        ticketUrl: pixCharge.ticketUrl,
        paymentId: pixCharge.id,
        paymentStatus: pixCharge.status || "pending",
        expiresAt: pixCharge.expiresAt,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao gerar cobranca PIX.",
      error: error.message,
    });
  }
});

export default router;
