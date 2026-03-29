import express from "express";
import bcrypt from "bcryptjs";
import validator from "validator";
import jwt from "jsonwebtoken";
import "dotenv/config";
import Users from "../../models/Users.js";
import EmailService from "../../service/email.js";
import { readFirstAccessState } from "./Login.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

function buildAuthToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, establishment: user.establishment },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

router.post("/loginfunc", async (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Preencha o campo de e-mail" });
  }

  const emailTrimmed = email.trim();
  if (!validator.isEmail(emailTrimmed)) {
    return res.status(400).json({ message: "Email invalido" });
  }

  try {
    const user = await Users.findOne({
      where: { email: emailTrimmed, role: "funcionario" },
    });

    if (!user) {
      return res.status(404).json({ message: "Usuario inexistente" });
    }

    if (!user.status) {
      return res.status(403).json({
        message: "Sua conta esta desativada. Entre em contato com o proprietario.",
      });
    }

    const establishment = await Users.findOne({
      where: { id: user.establishment },
    });

    if (establishment && establishment.expirationDate) {
      const expirationDate = new Date(establishment.expirationDate);
      const currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);
      expirationDate.setDate(expirationDate.getDate() + 1);

      if (expirationDate < currentDate) {
        return res.status(403).json({
          message: "A assinatura do estabelecimento expirou. Por favor, entre em contato com o proprietario.",
        });
      }
    }

    if (!user.password) {
      return res.status(403).json({
        message: "Este funcionario ainda nao possui senha provisoria cadastrada. Gere o primeiro acesso no administrativo.",
      });
    }

    if (!password) {
      return res.status(401).json({
        message: "Informe a senha para entrar no sistema.",
      });
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      return res.status(401).json({ message: "Senha incorreta" });
    }

    const firstAccessState = readFirstAccessState(user);
    if (firstAccessState.active) {
      return res.status(200).json({
        requiresPasswordChange: true,
        firstAccessToken: user.recoveryPassToken,
        firstAccessExpiresAt: user.timeRecoveryPass,
        email: user.email,
        name: user.name,
        role: user.role,
        message: "Primeiro acesso identificado. Defina sua nova senha para entrar no sistema.",
      });
    }

    const token = buildAuthToken(user);

    try {
      await EmailService.sendEmployeeLoginNotificationEmail(
        user.email,
        user.name,
        establishment?.name || "ViaPet",
      );
    } catch (error) {
      console.error("Notificacao de login do funcionario nao pode ser enviada:", error.message);
    }

    return res.status(200).json({
      message: `Login bem-sucedido! Bem-vindo, ${user.name}`,
      token,
    });
  } catch (error) {
    console.error("Erro no servidor:", error);
    return res.status(500).json({
      message: "Erro no servidor. Tente novamente mais tarde.",
    });
  }
});

export default router;
