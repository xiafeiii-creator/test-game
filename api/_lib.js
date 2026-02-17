import crypto from "crypto";

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function bad(res, msg = "Bad request") {
  return json(res, 400, { ok: false, error: msg });
}

export function method(res, req, allowed = ["POST"]) {
  if (!allowed.includes(req.method)) {
    res.statusCode = 405;
    res.setHeader("Allow", allowed.join(", "));
    res.end("Method Not Allowed");
    return false;
  }
  return true;
}

export async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

// Telegram WebApp initData verification (HMAC-SHA256)
// Docs concept: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyTelegramInitData(initData, botToken) {
  if (!initData || typeof initData !== "string") return { ok: false, error: "Missing initData" };
  if (!botToken) return { ok: false, error: "Missing bot token" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "Missing hash" };

  // Create data-check-string
  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computed !== hash) return { ok: false, error: "Invalid signature" };

  // Extract user from initDataUnsafe.user (comes as JSON string in param 'user')
  const userStr = params.get("user");
  if (!userStr) return { ok: false, error: "Missing user" };
  let user;
  try { user = JSON.parse(userStr); } catch { return { ok: false, error: "Bad user JSON" }; }
  if (!user?.id) return { ok: false, error: "Missing user.id" };

  return { ok: true, user, auth_date: Number(params.get("auth_date") || 0) };
}

export async function supabaseFetch(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}
