import express from "express";
import authenticate from "../middlewares/auth.js";
import { logActivity } from "../service/activityLogger.js";

const router = express.Router();

/**
 * Endpoints chamados pelo frontend para reportar:
 *  - navegação por tela (page-view)
 *  - erros de UI (toasts de erro, falhas de save)
 *  - logout (o frontend só apaga o token; o backend não vê nada — então o
 *    front bate aqui antes de descartar o token)
 */

// POST /activity/page-view  { path, title? }
router.post("/activity/page-view", authenticate, async (req, res) => {
  const path = String(req.body?.path || "").slice(0, 240);
  const title = req.body?.title ? String(req.body.title).slice(0, 180) : null;
  if (!path) return res.status(400).json({ ok: false, message: "path obrigatório" });

  await logActivity({
    req,
    modulo: "navegacao",
    acao: "page_view",
    descricao: title ? `${title} (${path})` : path,
    entidadeTipo: "rota",
    entidadeId: path,
    metadata: { path, title },
  });

  return res.status(204).end();
});

// POST /activity/error  { message, path?, code? }
router.post("/activity/error", authenticate, async (req, res) => {
  const message = String(req.body?.message || "Erro desconhecido").slice(0, 500);
  const path = req.body?.path ? String(req.body.path).slice(0, 240) : null;
  const code = req.body?.code ? String(req.body.code).slice(0, 60) : null;

  await logActivity({
    req,
    modulo: "ui",
    acao: "client_error",
    descricao: message,
    entidadeTipo: path ? "rota" : null,
    entidadeId: path,
    metadata: { code, path },
  });

  return res.status(204).end();
});

// POST /activity/logout
router.post("/activity/logout", authenticate, async (req, res) => {
  await logActivity({
    req,
    modulo: "auth",
    acao: "logout",
    descricao: "Sessão encerrada pelo usuário",
  });
  return res.status(204).end();
});

export default router;
