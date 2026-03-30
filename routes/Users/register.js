import express from "express";
import validator from "validator";
import bcrypt from "bcryptjs";
import Users from "../../models/Users.js";
import Subscription from "../../models/Subscription.js";
import EmailService from "../../service/email.js";
import { ensureDefaultMedicalCatalog } from "../../service/defaultMedicalCatalog.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password || !phone) {
    return res.status(400).json({ message: "Preencha todos os campos" });
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ message: "Email invalido" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "A senha deve ter no minimo 6 caracteres" });
  }

  try {
    const user = await Users.findOne({ where: { email } });
    if (user) {
      return res.status(400).json({ message: "Ja existe uma conta cadastrada com este e-mail" });
    }

    const passHash = await bcrypt.hash(password, 10);

    const expirationDate = new Date();
    expirationDate.setMonth(expirationDate.getMonth() + 1);

    const userCreate = await Users.create({
      name,
      email,
      password: passHash,
      establishment: null,
      expirationDate,
      plan: false,
      phone,
    });

    userCreate.establishment = userCreate.id;
    await userCreate.save();

    await ensureDefaultMedicalCatalog(userCreate.id);

    const trialStartDate = new Date();
    const trialEndDate = new Date();
    trialEndDate.setMonth(trialEndDate.getMonth() + 1);

    await Subscription.create({
      user_id: userCreate.id,
      plan_type: "trial",
      status: "active",
      amount: 0,
      currency: "BRL",
      trial_start: trialStartDate,
      trial_end: trialEndDate,
      billing_cycle_start: trialEndDate,
      next_billing_date: trialEndDate,
      notes: "Assinatura trial criada automaticamente no registro",
    });

    EmailService.sendWelcomeEmail(userCreate.id, email).catch((error) => {
      console.error("Email de boas-vindas nao pode ser enviado:", error.message);
    });

    return res.status(201).json({ message: "Conta criada com sucesso!" });
  } catch (error) {
    console.error("Erro ao criar a conta:", error);
    return res.status(500).json({ message: "Ocorreu um erro ao criar sua conta" });
  }
});

export default router;
