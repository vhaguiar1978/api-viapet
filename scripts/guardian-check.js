const API_URL = String(process.env.GUARDIAN_API_URL || "https://api.viapet.app").replace(/\/+$/, "");
const APP_URL = String(process.env.GUARDIAN_APP_URL || "https://app.viapet.app").replace(/\/+$/, "");
const DEPLOY_HOOK = String(process.env.RENDER_DEPLOY_HOOK_URL || "").trim();
const ALERT_WEBHOOK = String(process.env.GUARDIAN_ALERT_WEBHOOK_URL || "").trim();

async function request(url, options = {}, timeoutMs = 20000) {
  const startedAt = Date.now();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: response.ok, status: response.status, latencyMs: Date.now() - startedAt, body };
}

async function alert(event, details) {
  if (!ALERT_WEBHOOK) return;
  await request(ALERT_WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "ViaPet Guardiao Externo", event, at: new Date().toISOString(), ...details }),
  }, 10000).catch(() => {});
}

async function runChecks() {
  const app = await request(APP_URL);
  if (!app.ok || !String(app.body).includes("id=\"root\"")) throw new Error(`frontend_${app.status}`);
  const ready = await request(`${API_URL}/health/ready`, {}, 30000);
  if (!ready.ok || !ready.body?.ok) throw new Error(`api_ready_${ready.status}_${ready.body?.lastError || "unknown"}`);

  const email = String(process.env.GUARDIAN_TEST_EMAIL || "").trim();
  const password = String(process.env.GUARDIAN_TEST_PASSWORD || "");
  if (email && password) {
    const login = await request(`${API_URL}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }, 30000);
    if (!login.ok || !login.body?.token) throw new Error(`synthetic_login_${login.status}`);
    const headers = { authorization: `Bearer ${login.body.token}` };
    const [account, agenda] = await Promise.all([
      request(`${API_URL}/account`, { headers }, 30000),
      request(`${API_URL}/agenda/settings`, { headers }, 30000),
    ]);
    if (!account.ok) throw new Error(`synthetic_account_${account.status}`);
    if (!agenda.ok && agenda.status !== 404) throw new Error(`synthetic_agenda_${agenda.status}`);
  }
  return { app, ready };
}

try {
  const result = await runChecks();
  console.log(JSON.stringify({ ok: true, appMs: result.app.latencyMs, apiMs: result.ready.latencyMs }));
} catch (error) {
  const message = String(error?.message || error);
  console.error(`[guardian] falha: ${message}`);
  await alert("monitor_failed", { message });
  if (DEPLOY_HOOK) {
    const redeploy = await request(DEPLOY_HOOK, { method: "POST" }, 20000).catch(() => null);
    console.error(`[guardian] redeploy solicitado: ${Boolean(redeploy?.ok)}`);
    await alert("redeploy_requested", { message, accepted: Boolean(redeploy?.ok) });
  }
  process.exit(1);
}

