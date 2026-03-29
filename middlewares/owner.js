import Users from "../models/Users.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

const owner = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  const token = authHeader.split(" ")[1]; // Remove "Bearer" do token (formato: "Bearer token_aqui")

  if (!token) {
    return res.status(401).json({ message: "Token inválido" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET); // Verifica o token
    const { role } = decoded;

    if (role !== "proprietario" && role !== "admin") {
      return res.status(403).json({
        message:
          "Acesso negado. Somente proprietários e administradores podem acessar esta rota.",
      });
    }

    req.user = {
      id: decoded.id,
      role: decoded.role,
      establishment: decoded.establishment,
    };

    next(); // Passa para a próxima função
  } catch (error) {
    return res.status(403).json({ message: "Token inválido ou expirado" });
  }
};

export default owner;
