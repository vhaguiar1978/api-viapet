import express from "express";
import Users from "../../models/Users.js";
import validator from "validator";
import jwt from "jsonwebtoken";
import "dotenv/config";
import emailService from "../../service/email.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

router.post("/resetPassToken", async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    return res.status(400).json({ message: "Email nao informado" });
  }

  if (!validator.isEmail(normalizedEmail)) {
    return res.status(400).json({ message: "Email invalido" });
  }

  const user = await Users.findOne({ where: { email: normalizedEmail } });
  if (!user) {
    return res.status(400).json({ message: "Usuario inexistente" });
  }

  const token = jwt.sign(
    {
      id: user.id,
      resetpass: true,
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  user.recoveryPassToken = token;
  user.timeRecoveryPass = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  try {
    await emailService.sendPasswordResetEmail(normalizedEmail, token);
    return res.status(200).json({
      message: "O link para redefinir a senha foi encaminhado via email.",
    });
  } catch (emailError) {
    console.error("Erro ao enviar email de reset de senha:", emailError.message);
    return res.status(500).json({
      message:
        emailError.message ||
        "Token criado, mas nao foi possivel enviar o email. Tente novamente em alguns minutos.",
    });
  }
});

export default router;
