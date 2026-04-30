import express from "express";
import bcrypt from "bcryptjs";
import validator from "validator";
import jwt from "jsonwebtoken";
import net from "node:net";
import "dotenv/config";
import Users from "../../models/Users.js";
import EmailService from "../../service/email.js";
import { readFirstAccessState } from "./Login.js";
import LoginHistory from "../../models/LoginHistory.js";

const router = express.Router();

function getJwtSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.JWTSECRET ||
    process.env.JWT_SECRET_KEY ||
    "viapet_jwt_fallback_change_me"
  );
}

function buildAuthToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, establishment: user.establishment },
    getJwtSecret(),
    { expiresIn: "7d" },
  );
}

function normalizeIpCandidate(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "undefined" || trimmed.toLowerCase() === "null") {
    return null;
  }
  const normalized = trimmed.startsWith("::ffff:") ? trimmed.replace("::ffff:", "") : trimmed;
  return net.isIP(normalized) ? normalized : null;
}

function resolveClientIp(req) {
  const xff = req?.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const first = xff.split(",")[0];
    const parsed = normalizeIpCandidate(first);
    if (parsed) return parsed;
  }

  const socketIp = normalizeIpCandidate(req?.socket?.remoteAddress);
  if (socketIp) return socketIp;

  const connectionIp = normalizeIpCandidate(req?.connection?.remoteAddress);
  if (connectionIp) return connectionIp;

  return null;
}

async function registerLoginHistory(userId, req, status = "success") {
  if (!userId) {
    return;
  }
  try {
    const clientIp = resolveClientIp(req) || "0.0.0.0";
    await LoginHistory.create({
      userId,
      ip: clientIp,
      userAgent: req.headers["user-agent"],
      status,
      device:
        req.headers["user-agent"]?.split("(")[1]?.split(")")[0] || "Unknown",
    });
  } catch (error) {
    console.warn("Falha ao gravar historico de login do funcionario:", error.message);
  }
}

router.post("/loginfunc", async (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Preencha o campo de e-mail" });
  }

  const emailTrimmed = String(email || "").trim().toLowerCase();
  if (!validator.isEmail(emailTrimmed)) {
    return res.status(400).json({ message: "Email invalido" });
  }

  try {
    const user = await Users.findOne({
      where: { email: emailTrimmed, role: "funcionario" },
    });

    if (!user) {
      await registerLoginHistory(null, req, "failed");
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
      await registerLoginHistory(user.id, req, "failed");
      return res.status(401).json({
        message: "Informe a senha para entrar no sistema.",
      });
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      await registerLoginHistory(user.id, req, "failed");
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
    await registerLoginHistory(user.id, req, "success");
    try {
      await user.update({ lastAccess: new Date() });
    } catch {
      // coluna pode nao existir em instancias antigas
    }

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
