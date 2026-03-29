import express from "express";
import Users from "../../models/Users.js";
import validator from "validator";
import jwt from "jsonwebtoken";
import "dotenv/config";
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
import emailService from "../../service/email.js";

router.post("/resetPassToken", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email não informado" });
  }
  if (!validator.isEmail(email)) {
    return res.status(400).json({ message: "Email inválido" });
  }
  const user = await Users.findOne({ where: { email: email } });
  if (!user) {
    return res.status(400).json({ message: "Usuário Inexistente" });
  }
  const token = jwt.sign(
    {
      id: user.id,
      resetpass: true,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  user.recoveryPassToken = token;
  const currentTime = new Date();
  const timeRecoveryPass = new Date(currentTime.getTime() + 60 * 60 * 1000);
  user.timeRecoveryPass = timeRecoveryPass;
  await user.save();

  // FUNCAO ENVIAR O LINK COM TOKEN VIA EMAIL OU WPP

  //REAL
  try {
    await emailService.sendPasswordResetEmail(email, token);
    return res.status(200).json({
      message: "O link para redefinir a senha foi encaminhado via email",
    });
  } catch (emailError) {
    console.error(
      "❌ Erro ao enviar email de reset de senha:",
      emailError.message
    );
    return res.status(500).json({
      message:
        "Token criado, mas não foi possível enviar o email. Tente novamente em alguns minutos.",
    });
  }
});

export default router;
