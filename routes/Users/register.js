import express from "express";
import Users from "../../models/Users.js";
import Subscription from "../../models/Subscription.js";
import validator from "validator";
import bcrypt from "bcryptjs";
import EmailService from "../../service/email.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password || !phone) {
    return res.status(400).json({ message: "Preencha todos os campos" });
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ message: "Email inválido" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ message: "A senha deve ter no mínimo 6 caracteres" });
  }

  try {
    const user = await Users.findOne({ where: { email } });
    if (user) {
      return res
        .status(400)
        .json({ message: "Já existe uma conta cadastrada com este e-mail" });
    }

    const passHash = await bcrypt.hash(password, 10);

    // Calculate expiration date 1 month from now
    const expirationDate = new Date();
    expirationDate.setMonth(expirationDate.getMonth() + 1);

    const userCreate = await Users.create({
      name,
      email,
      password: passHash,
      establishment: null,
      expirationDate: expirationDate,
      plan: false,
      phone: phone,
    });

    // Update establishment after creation
    userCreate.establishment = userCreate.id;
    await userCreate.save();

    // Create trial subscription for the new user
    const trialStartDate = new Date();
    const trialEndDate = new Date();
    trialEndDate.setMonth(trialEndDate.getMonth() + 1); // 1 month free trial

    await Subscription.create({
      user_id: userCreate.id,
      plan_type: 'trial',
      status: 'active',
      amount: 0.00, // Free trial
      currency: 'BRL',
      trial_start: trialStartDate,
      trial_end: trialEndDate,
      billing_cycle_start: trialEndDate, // Next billing starts after trial
      next_billing_date: trialEndDate,
      notes: 'Assinatura trial criada automaticamente no registro'
    });

    // Envia email de boas-vindas de forma assíncrona (não bloqueia o registro)
    try {
      await EmailService.sendWelcomeEmail(userCreate.id, email);
    } catch (error) {
      // Log do erro mas não impede o sucesso do registro
      console.error(
        "⚠️  Email de boas-vindas não pôde ser enviado:",
        error.message
      );
    }

    return res.status(201).json({ message: "Conta criada com sucesso!" });
  } catch (error) {
    console.error("Erro ao criar a conta:", error);
    return res
      .status(500)
      .json({ message: "Ocorreu um erro ao criar sua conta" });
  }
});

export default router;
