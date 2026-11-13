import sequelize from "../database/config.js";

const numberEnv = (name, fallback, min, max) => {
  const parsed = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const state = {
  startedAt: new Date().toISOString(),
  status: "starting",
  database: "unknown",
  consecutiveFailures: 0,
  lastCheckAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastLatencyMs: null,
  lastRecoveryAt: null,
  recoveryCount: 0,
  restartScheduled: false,
  lastError: "",
};

let probeInFlight = null;
let monitorTimer = null;
let lastAlertKey = "";
let lastAlertAt = 0;

function publicState() {
  return { ...state, uptimeSeconds: Math.floor(process.uptime()) };
}

async function notify(event, details = {}) {
  const webhookUrl = String(process.env.GUARDIAN_ALERT_WEBHOOK_URL || "").trim();
  if (!webhookUrl) return;
  const key = `${event}:${details.message || ""}`;
  const now = Date.now();
  if (key === lastAlertKey && now - lastAlertAt < 15 * 60 * 1000) return;
  lastAlertKey = key;
  lastAlertAt = now;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "ViaPet Guardiao",
        event,
        at: new Date().toISOString(),
        environment: process.env.NODE_ENV || "unknown",
        ...details,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.warn(`[guardian] alerta nao enviado: ${error.message}`);
  }
}

async function databaseProbe() {
  const timeoutMs = numberEnv("GUARDIAN_DB_TIMEOUT_MS", 10000, 2000, 30000);
  const startedAt = Date.now();
  let timeout;
  try {
    await Promise.race([
      sequelize.query("SELECT 1 AS guardian_ok"),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`database_timeout_${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timeout);
  }
}

async function resetDatabasePool() {
  const pool = sequelize?.connectionManager?.pool;
  if (!pool || typeof pool.destroyAllNow !== "function") return false;
  await pool.destroyAllNow();
  return true;
}

async function recoverDatabase() {
  state.lastRecoveryAt = new Date().toISOString();
  state.recoveryCount += 1;
  console.warn(`[guardian] recuperacao do pool iniciada (${state.recoveryCount})`);
  try {
    await resetDatabasePool();
    const retry = await databaseProbe();
    state.database = "healthy";
    state.status = "healthy";
    state.consecutiveFailures = 0;
    state.lastSuccessAt = new Date().toISOString();
    state.lastLatencyMs = retry.latencyMs;
    state.lastError = "";
    await notify("recovered", { message: "Banco recuperado apos renovacao do pool." });
    return true;
  } catch (error) {
    state.lastError = String(error?.message || error).slice(0, 240);
    return false;
  }
}

async function performProbe({ allowRecovery = false } = {}) {
  state.lastCheckAt = new Date().toISOString();
  try {
    const result = await databaseProbe();
    const wasUnhealthy = state.status !== "healthy";
    state.status = "healthy";
    state.database = "healthy";
    state.consecutiveFailures = 0;
    state.lastSuccessAt = new Date().toISOString();
    state.lastLatencyMs = result.latencyMs;
    state.lastError = "";
    if (wasUnhealthy && state.lastFailureAt) {
      await notify("recovered", { message: "API e banco voltaram a responder." });
    }
    return { ok: true, ...publicState() };
  } catch (error) {
    state.status = "unhealthy";
    state.database = "unhealthy";
    state.consecutiveFailures += 1;
    state.lastFailureAt = new Date().toISOString();
    state.lastError = String(error?.message || error).slice(0, 240);
    const threshold = numberEnv("GUARDIAN_FAILURE_THRESHOLD", 3, 2, 10);
    if (state.consecutiveFailures === threshold) {
      await notify("database_unhealthy", {
        message: state.lastError,
        consecutiveFailures: state.consecutiveFailures,
      });
    }
    if (allowRecovery && state.consecutiveFailures >= threshold) {
      const recovered = await recoverDatabase();
      if (!recovered && process.env.GUARDIAN_AUTO_RESTART !== "false" && !state.restartScheduled) {
        state.restartScheduled = true;
        await notify("restart_scheduled", { message: "Reinicio seguro da API agendado." });
        console.error("[guardian] banco indisponivel; encerrando para o Render reiniciar a API");
        setTimeout(() => process.exit(1), 1000).unref();
      }
    }
    return { ok: false, ...publicState() };
  }
}

export function runGuardianProbe(options = {}) {
  if (!probeInFlight) {
    probeInFlight = performProbe(options).finally(() => {
      probeInFlight = null;
    });
  }
  return probeInFlight;
}

export function getGuardianStatus() {
  return publicState();
}

export function startSystemGuardian() {
  if (monitorTimer || process.env.GUARDIAN_ENABLED === "false") return;
  const intervalMs = numberEnv("GUARDIAN_INTERVAL_MS", 60000, 30000, 15 * 60 * 1000);
  const tick = () => runGuardianProbe({ allowRecovery: true }).catch((error) => {
    console.error("[guardian] falha inesperada:", error.message);
  });
  setTimeout(tick, 5000).unref();
  monitorTimer = setInterval(tick, intervalMs);
  monitorTimer.unref();
  console.log(`[guardian] monitor ativo a cada ${Math.round(intervalMs / 1000)}s`);
}

