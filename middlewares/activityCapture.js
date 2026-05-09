import { logActivity } from "../service/activityLogger.js";

// Anexa um helper `req.logActivity(...)` que herda o req atual.
// Ex.: req.logActivity({ modulo: "agenda", acao: "appointment_created", ... })
export function attachActivityHelper(req, _res, next) {
  req.logActivity = (params = {}) => logActivity({ ...params, req });
  next();
}

// Express error handler — registra erros não tratados no activity_logs
// para alimentar o card "erros recentes" do dashboard.
export function activityErrorHandler(err, req, res, next) {
  if (!err) return next();
  try {
    logActivity({
      req,
      modulo: "system",
      acao: "server_error",
      descricao: err?.message ? String(err.message).slice(0, 500) : "Erro interno",
      metadata: {
        path: req?.originalUrl || req?.url,
        method: req?.method,
        statusCode: err?.statusCode || err?.status || 500,
        name: err?.name,
      },
    });
  } catch {
    // log de log nunca deve travar
  }
  next(err);
}

export default { attachActivityHelper, activityErrorHandler };
