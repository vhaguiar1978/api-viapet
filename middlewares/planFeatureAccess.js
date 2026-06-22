import jwt from "jsonwebtoken";
import { hasPlanFeature, resolvePlanAccess } from "../service/planAccess.js";

const ROUTE_FEATURES = [
  [/^\/api\/crm-ai-assistant(?:\/|$)/, "crm-ai"],
  [/^\/api\/crm-ai(?:\/|$)/, "crm-ai"],
  [/^\/crm-(?:whatsapp|conversations|automations|baileys)(?:\/|$)/, "crm"],
  [/^\/whatsapp-crm-config(?:\/|$)/, "whatsapp"],
  [/^\/finance(?:\/|$)/, "financeiro"],
  [/^\/(?:monthly-stats|financial-data|summary)(?:\/|$)/, "financeiro"],
  [/^\/sales(?:\/|$)/, "venda"],
  [/^\/appointments\/queue\/internacao(?:\/|$)/, "internacao"],
  [/^\/appointments\/queue\/exame(?:\/|$)/, "exames"],
  [/^\/appointments\/queue\/geral(?:\/|$)/, "fila"],
  [/^\/appointments(?:\/|$)/, "agenda"],
  [/^\/agenda(?:\/|$)/, "agenda"],
  [/^\/(?:products|product|addProduct|editProduct|deleteproduct)(?:\/|$)/, "cadastros"],
  [/^\/services(?:\/|$)/, "cadastros"],
  [/^\/(?:customers|customer-data|custumer|client)(?:\/|$)/, "clientes"],
  [/^\/(?:pets|pet)(?:\/|$)/, "pets"],
];

function getJwtSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.JWTSECRET ||
    process.env.JWT_SECRET_KEY ||
    "viapet_jwt_fallback_change_me"
  );
}

function requiredFeature(pathname) {
  return ROUTE_FEATURES.find(([pattern]) => pattern.test(pathname))?.[1] || "";
}

export async function planFeatureAccess(req, res, next) {
  const feature = requiredFeature(req.path);
  if (!feature) return next();

  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const planAccess = await resolvePlanAccess({
      id: decoded.id,
      role: decoded.role,
      establishment: decoded.establishment,
    });

    if (!hasPlanFeature(planAccess, feature)) {
      return res.status(403).json({
        message: planAccess.blocked
          ? planAccess.reason
          : `Este recurso não está incluído no ${planAccess.planName}.`,
        code: "PLAN_FEATURE_NOT_INCLUDED",
        planAccess,
        requiredFeature: feature,
      });
    }
    req.planAccess = planAccess;
    return next();
  } catch (error) {
    // Tokens inválidos continuam sendo tratados pelo middleware de autenticação
    // de cada rota, mantendo a resposta existente da API.
    if (error?.name === "JsonWebTokenError" || error?.name === "TokenExpiredError") {
      return next();
    }
    console.error("Erro ao validar acesso do plano:", error);
    return res.status(503).json({
      message: "Não foi possível validar os recursos do plano agora.",
      code: "PLAN_ACCESS_UNAVAILABLE",
    });
  }
}
