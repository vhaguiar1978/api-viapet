import express from "express";
import Users from "../../models/Users.js";
import jwt from "jsonwebtoken";
import "dotenv/config";
import bcrypt from "bcryptjs";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

router.post("/resetpass", async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: "Preencha sua nova senha" });
  }

  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Acesso negado. Token vazio" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.resetpass !== true) {
      return res.status(400).json({ message: "Token invalido" });
    }

    const user = await Users.findByPk(decoded.id);
    if (!user) {
      return res.status(404).json({ message: "Usuario nao encontrado" });
    }

    if (!user.recoveryPassToken || user.recoveryPassToken !== token) {
      return res.status(401).json({ message: "Token invalido ou ja utilizado" });
    }

    if (!user.timeRecoveryPass || new Date(user.timeRecoveryPass) < new Date()) {
      return res.status(401).json({ message: "O link de redefinicao expirou" });
    }

    const passHash = await bcrypt.hash(password, 10);
    user.password = passHash;
    user.recoveryPassToken = null;
    user.timeRecoveryPass = null;
    await user.save();

    return res.status(200).json({ message: "Senha alterada com sucesso" });
  } catch {
    return res.status(401).json({ message: "Token invalido" });
  }
});

export default router;
