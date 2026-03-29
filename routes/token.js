import express from "express";
import jwt from "jsonwebtoken";
import "dotenv/config";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

router.post("/verify-token", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Token não fornecido" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.status(200).json({
      valid: true,
      user: {
        id: decoded.id,
        role: decoded.role,
        establishment: decoded.establishment,
      },
    });
  } catch (error) {
    return res.status(401).json({
      valid: false,
      message: "Token inválido ou expirado",
    });
  }
});

export default router;
