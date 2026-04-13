import express from "express";
import bcrypt from "bcryptjs";
import validator from "validator";
import jwt from "jsonwebtoken";
import "dotenv/config";
import Users from "../../models/Users.js";
import LoginHistory from "../../models/LoginHistory.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

function buildAuthToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      establishment: user.establishment,
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
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

function readFirstAccessState(user) {
  if (!user?.recoveryPassToken || !user?.timeRecoveryPass) {
    return { active: false, reason: "missing" };
  }

  try {
    const decoded = jwt.verify(user.recoveryPassToken, JWT_SECRET);
    const expiresAt = new Date(user.timeRecoveryPass);
    const active = decoded?.firstaccess === true && expiresAt >= new Date();
    return { active, decoded, expiresAt };
  } catch {
    return { active: false, reason: "invalid" };
  }
}

async function validateEstablishmentExpiration(user) {
  const establishment = await Users.findOne({
    where: { id: user.establishment },
  });

  if (!establishment || !establishment.expirationDate) {
    return { ok: true, establishment };
  }

  const expirationDate = new Date(establishment.expirationDate);
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  expirationDate.setDate(expirationDate.getDate() + 1);

  if (expirationDate < currentDate) {
    return {
      ok: false,
      message:
        "A assinatura do estabelecimento expirou. Por favor, entre em contato com o proprietario.",
    };
  }

  return { ok: true, establishment };
}

async function registerLoginHistory(userId, req, status = "success") {
  if (!userId) {
    return;
  }

  await LoginHistory.create({
    userId,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    status,
    device:
      req.headers["user-agent"]?.split("(")[1]?.split(")")[0] || "Unknown",
  });
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: "Preencha todos os campos" });
    }

    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Email invalido" });
    }

    const user = await Users.findOne({ where: { email: normalizedEmail } });

    if (!user) {
      await registerLoginHistory(null, req, "failed");
      return res.status(401).json({ message: "Email ou senha invalidos" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      await registerLoginHistory(user.id, req, "failed");
      return res.status(401).json({ message: "Email ou senha invalidos" });
    }

    if (!user.status) {
      return res.status(403).json({
        message: "Usuario inativo. Entre em contato com o administrador.",
      });
    }

    const establishmentValidation = await validateEstablishmentExpiration(user);
    if (!establishmentValidation.ok) {
      return res.status(403).json({
        message: establishmentValidation.message,
      });
    }

    const firstAccessState = readFirstAccessState(user);
    if (firstAccessState.active) {
      return res.status(200).json({
        requiresPasswordChange: true,
        firstAccessToken: user.recoveryPassToken,
        firstAccessExpiresAt: user.timeRecoveryPass,
        email: user.email,
        name: user.name,
        message: "Primeiro acesso identificado. Defina sua nova senha para entrar no sistema.",
      });
    }

    const token = buildAuthToken(user);

    await registerLoginHistory(user.id, req, "success");
    await user.update({
      lastAccess: new Date(),
    });

    return res.status(200).json({
      message: `Login bem-sucedido! Bem-vindo novamente ${user.name}`,
      token,
      role: user.role,
    });
  } catch (error) {
    console.error("Erro no login:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.post("/login/complete-first-access", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        message: "Informe a nova senha para concluir o primeiro acesso.",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.firstaccess !== true) {
      return res.status(400).json({ message: "Token de primeiro acesso invalido." });
    }

    const user = await Users.findByPk(decoded.id);
    if (!user) {
      return res.status(404).json({ message: "Usuario nao encontrado." });
    }

    const firstAccessState = readFirstAccessState(user);
    if (!firstAccessState.active || user.recoveryPassToken !== token) {
      return res.status(401).json({
        message: "O primeiro acesso nao esta mais valido. Solicite uma nova senha provisoria.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.recoveryPassToken = null;
    user.timeRecoveryPass = null;
    user.lastAccess = new Date();
    await user.save();

    const authToken = buildAuthToken(user);
    await registerLoginHistory(user.id, req, "success");

    return res.status(200).json({
      message: "Primeiro acesso concluido com sucesso.",
      token: authToken,
      role: user.role,
    });
  } catch (error) {
    console.error("Erro ao concluir primeiro acesso:", error);
    return res.status(401).json({
      message: "Nao foi possivel concluir o primeiro acesso.",
      error: error.message,
    });
  }
});

router.post("/login/reset-first-access", async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Informe um email valido." });
    }

    const user = await Users.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(404).json({ message: "Usuario nao encontrado." });
    }

    const { token, expiresAt } = buildFirstAccessToken(user);
    user.recoveryPassToken = token;
    user.timeRecoveryPass = expiresAt;
    await user.save();

    return res.status(200).json({
      message: "Primeiro acesso resetado com sucesso.",
      firstAccessToken: token,
      firstAccessExpiresAt: expiresAt,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel resetar o primeiro acesso.",
      error: error.message,
    });
  }
});

export { buildFirstAccessToken, readFirstAccessState };
export default router;
