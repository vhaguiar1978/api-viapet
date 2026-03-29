import jwt from "jsonwebtoken";
import "dotenv/config";
const JWT_SECRET = process.env.JWT_SECRET;

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Bearer <token>

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
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Token Invalido",
    });
  }
};
export default authenticate;
