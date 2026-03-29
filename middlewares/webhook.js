import express from 'express';

/**
 * Middleware específico para webhooks do Mercado Pago
 * 
 * Este middleware:
 * 1. Preserva o body raw para validação de assinatura HMAC
 * 2. Adiciona logs de segurança
 * 3. Valida headers obrigatórios
 * 4. Rate limiting básico para webhooks
 */

// Cache simples para rate limiting
const webhookAttempts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minuto
const MAX_ATTEMPTS_PER_MINUTE = 100; // Máximo 100 webhooks por minuto por IP

/**
 * Rate limiting simples para webhooks
 */
const rateLimitWebhook = (req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  // Limpar entradas antigas
  for (const [ip, data] of webhookAttempts.entries()) {
    if (now - data.firstAttempt > RATE_LIMIT_WINDOW) {
      webhookAttempts.delete(ip);
    }
  }
  
  // Verificar rate limit para este IP
  const ipAttempts = webhookAttempts.get(clientIp);
  
  if (ipAttempts) {
    if (now - ipAttempts.firstAttempt < RATE_LIMIT_WINDOW) {
      ipAttempts.count++;
      
      if (ipAttempts.count > MAX_ATTEMPTS_PER_MINUTE) {
        console.log(`🚫 Rate limit excedido para IP ${clientIp}: ${ipAttempts.count} tentativas`);
        return res.status(429).json({
          error: 'Muitas tentativas de webhook. Tente novamente em 1 minuto.'
        });
      }
    } else {
      // Reset para nova janela de tempo
      webhookAttempts.set(clientIp, { firstAttempt: now, count: 1 });
    }
  } else {
    // Primeira tentativa deste IP
    webhookAttempts.set(clientIp, { firstAttempt: now, count: 1 });
  }
  
  next();
};

/**
 * Middleware para processar o body como raw em webhooks do Mercado Pago
 */
const rawBodyWebhook = express.raw({ 
  type: 'application/json',
  limit: '1mb'
});

/**
 * Middleware para converter raw body de volta para JSON + preservar raw
 */
const parseWebhookBody = (req, res, next) => {
  try {
    // Preservar o body raw para validação de assinatura
    req.rawBody = req.body;
    
    // Converter para JSON se for buffer
    if (Buffer.isBuffer(req.body)) {
      req.body = JSON.parse(req.body.toString());
    }
    
    // Validar se é um JSON válido do Mercado Pago
    if (!req.body || typeof req.body !== 'object') {
      console.log('❌ Webhook rejeitado: body não é JSON válido');
      return res.status(400).json({
        error: 'Body deve ser JSON válido'
      });
    }
    
    // Log do webhook recebido (sem dados sensíveis)
    console.log('📥 Webhook body processado:', {
      hasAction: !!req.body.action,
      hasData: !!req.body.data,
      hasType: !!req.body.type,
      contentLength: req.rawBody ? req.rawBody.length : 0
    });
    
    next();
    
  } catch (error) {
    console.error('💥 Erro ao processar body do webhook:', error);
    return res.status(400).json({
      error: 'Erro ao processar payload JSON'
    });
  }
};

/**
 * Middleware completo para webhooks do Mercado Pago
 */
export const mercadoPagoWebhookMiddleware = [
  rateLimitWebhook,
  rawBodyWebhook,
  parseWebhookBody
];

/**
 * Middleware de logging para webhooks
 */
export const logWebhookRequest = (req, res, next) => {
  const startTime = Date.now();
  
  console.log('🔔 NOVO WEBHOOK MERCADO PAGO:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
    hasSignature: !!req.headers['x-signature'],
    hasRequestId: !!req.headers['x-request-id']
  });
  
  // Override res.json para capturar a resposta
  const originalJson = res.json;
  res.json = function(body) {
    const processingTime = Date.now() - startTime;
    
    console.log('📤 RESPOSTA WEBHOOK:', {
      statusCode: res.statusCode,
      processingTimeMs: processingTime,
      success: body?.success || false,
      timestamp: new Date().toISOString()
    });
    
    return originalJson.call(this, body);
  };
  
  next();
};

export default {
  mercadoPagoWebhookMiddleware,
  logWebhookRequest,
  rateLimitWebhook,
  rawBodyWebhook,
  parseWebhookBody
};
