import jwt from "jsonwebtoken";
import "dotenv/config";

function getJwtSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.JWTSECRET ||
    process.env.JWT_SECRET_KEY ||
    "viapet_jwt_fallback_change_me"
  );
}

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({
      message: "Acesso negado. Token vazio",
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
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
