import Users from "../models/Users.js";
import jwt from "jsonwebtoken";
import "dotenv/config";

const JWT_SECRET = process.env.JWT_SECRET;

const adminMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Acesso negado. Token vazio",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      role: decoded.role,
      establishment: decoded.establishment,
    };

    const user = await Users.findByPk(req.user.id);

    if (!user || user.role !== "admin") {
      return res.status(403).json({
        message:
          "Acesso negado. Apenas administradores podem acessar este recurso.",
      });
    }

    next();
  } catch (error) {
    console.error("Erro ao verificar permissão de administrador:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
};

export default adminMiddleware;
