// Every /api request must carry the review passcode in the x-review-key header.
// The passcode is the REVIEW_PASSCODE secret on the Cloudflare Pages project
// (locally: the .dev.vars file). If the secret is missing, the API stays locked.
//
// Cross-origin use: when the API runs on a different domain from the website
// (for example a WordPress or Webflow site), set ALLOWED_ORIGINS to a
// comma-separated list such as "https://client.com,https://www.client.com".
import { json } from "./_shared.js";

function same(a, b) {
  // constant-time comparison
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-review-key",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

const withHeaders = (res, extra) => {
  if (!extra) return res;
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
};

export async function onRequest({ request, env, next }) {
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });

  const expected = env.REVIEW_PASSCODE;
  if (!expected) return withHeaders(json({ error: "Review is not configured" }, 503), cors);
  const given = request.headers.get("x-review-key") || "";
  if (!same(given.trim().toLowerCase(), String(expected).trim().toLowerCase())) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return withHeaders(json({ error: "Wrong passcode" }, 401), cors);
  }
  return withHeaders(await next(), cors);
}
