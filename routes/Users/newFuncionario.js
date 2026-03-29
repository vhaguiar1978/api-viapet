import express from "express";
import Users from "../../models/Users.js";
import validator from "validator";
import authenticate from "../../middlewares/auth.js";
import owner from "../../middlewares/owner.js";
import EmailService from "../../service/email.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

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

export default router;
