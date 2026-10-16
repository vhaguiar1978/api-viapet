import express from "express";
import Users from "../../models/Users.js";
import validator from "validator";
import authenticate from "../../middlewares/auth.js";
import owner from "../../middlewares/owner.js";
import EmailService from "../../service/email.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

function generateTemporaryPassword() {
  const random = Math.random().toString(36).slice(-4).toUpperCase();
  return `ViaPet@${random}`;
}

function buildFirstAccessToken(user) {
  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      establishment: user.establishment,
      firstaccess: true,
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );

  return {
    token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

router.post("/registerFunc", authenticate, owner, async (req, res) => {
  const { name, email } = req.body;
  const establishment = req.user.establishment;

  if (!name || !email || !establishment) {
    return res.status(400).json({ message: "Preencha todos os campos" });
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ message: "Email inválido" });
  }
  const establishmentAccount = await Users.findByPk(establishment);
  if (!establishmentAccount) {
    return res.status(400).json({ message: "Establishment não encontrado" });
  }

  try {
    const user = await Users.findOne({ where: { email } });
    if (user) {
      return res
        .status(400)
        .json({ message: "Já existe uma conta cadastrada com este e-mail" });
    }

    const temporaryPassword = generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    const newEmployee = await Users.create({
      establishment,
      name,
      email,
      password: hashedPassword,
      role: "funcionario",
    });

    const firstAccess = buildFirstAccessToken(newEmployee);
    await newEmployee.update({
      recoveryPassToken: firstAccess.token,
      timeRecoveryPass: firstAccess.expiresAt,
    });

    // Send welcome email to employee
    try {
      await EmailService.sendEmployeeWelcomeEmail(
        email,
        name,
        establishmentAccount.name,
      );
    } catch (emailError) {
      console.error(
        "Erro ao enviar email de boas-vindas para funcionário:",
        emailError,
      );
      // Don't return error, just log it
    }

    return res.status(201).json({
      message: "Conta criada com sucesso!",
      data: {
        id: newEmployee.id,
        temporaryPassword,
        firstAccessRequired: true,
        firstAccessExpiresAt: firstAccess.expiresAt,
      },
    });
  } catch (error) {
    console.error("Erro ao criar a conta:", error);
    return res
      .status(500)
      .json({ message: "Ocorreu um erro ao criar sua conta" });
  }
});

router.post("/employee-invitations", authenticate, owner, async (req, res) => {
  if (req.user.role !== "proprietario") {
    return res.status(403).json({ message: "Somente o responsável da loja pode convidar funcionários." });
  }
  const establishment = req.user.establishment || req.user.id;
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!name || !validator.isEmail(email)) {
    return res.status(400).json({ message: "Informe o nome e um e-mail válido do vendedor." });
  }
  try {
    if (await Users.findOne({ where: { email } })) {
      return res.status(409).json({ message: "Este e-mail já possui uma conta no ViaPet." });
    }
    const establishmentAccount = await Users.findByPk(establishment);
    if (!establishmentAccount || establishmentAccount.role !== "proprietario") {
      return res.status(400).json({ message: "Não foi possível identificar a loja deste convite." });
    }
    const token = jwt.sign({ role: "employee_invitation", establishment, name, email,
      nonce: randomBytes(16).toString("hex") }, JWT_SECRET, { expiresIn: "7d", issuer: "viapet-employee-invitation" });
    const frontendUrl = String(process.env.FRONTEND_URL || "https://app.viapet.app").replace(/\/+$/, "");
    return res.status(201).json({ link: `${frontendUrl}/cadastro-funcionario?convite=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
  } catch (error) {
    console.error("Erro ao gerar convite de funcionário:", error);
    return res.status(500).json({ message: "Não foi possível gerar o convite." });
  }
});

router.post("/employee-invitations/accept", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: "viapet-employee-invitation" });
    if (decoded.role !== "employee_invitation" || !decoded.establishment || !decoded.email || !decoded.name) {
      return res.status(400).json({ message: "Este convite é inválido." });
    }
    const name = String(req.body.name || decoded.name).trim();
    const email = String(req.body.email || decoded.email).trim().toLowerCase();
    const password = String(req.body.password || "");
    if (email !== decoded.email || !name || password.length < 8) {
      return res.status(400).json({ message: "Confirme o e-mail do convite e crie uma senha com pelo menos 8 caracteres." });
    }
    const establishmentAccount = await Users.findByPk(decoded.establishment);
    if (!establishmentAccount || establishmentAccount.role !== "proprietario") {
      return res.status(400).json({ message: "A loja deste convite não está disponível." });
    }
    if (await Users.findOne({ where: { email } })) {
      return res.status(409).json({ message: "Este e-mail já possui uma conta no ViaPet." });
    }
    const employee = await Users.create({ establishment: decoded.establishment, name, email,
      password: await bcrypt.hash(password, 12), role: "funcionario" });
    return res.status(201).json({ message: "Cadastro concluído. Agora entre pelo login do ViaPet." });
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(400).json({ message: "Este convite expirou ou é inválido. Peça um novo link ao responsável da loja." });
    }
    console.error("Erro ao aceitar convite de funcionário:", error);
    return res.status(500).json({ message: "Não foi possível concluir o cadastro." });
  }
});

export default router;
