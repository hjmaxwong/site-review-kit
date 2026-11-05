// Shared helpers for the review API (Cloudflare Pages Functions + D1)
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

export const cleanPage = (p) => {
  p = clip(p || "/", 200).split("?")[0].split("#")[0];
  if (p === "" || p === "/index.html") p = "/";
  return p.replace(/\.html$/, "");
};

const TYPES = new Set(["pin", "draw", "box"]);
const num = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 10000) / 10000 : 0);

// Keep only the fields the client is allowed to set, with size limits
export function sanitizeItem(d) {
  if (!d || !TYPES.has(d.type)) return null;
  const anchor = d.anchor || {};
  const points = Array.isArray(d.points) ? d.points.slice(0, 2000).map((p) => [num(p[0]), num(p[1])]) : [];
  return {
    type: d.type,
    anchor: { sel: clip(anchor.sel, 400), fx: num(anchor.fx), fy: num(anchor.fy) },
    points,
    color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#e5484d",
    text: clip(d.text, 4000),
    author: clip(d.author, 60) || "Anonymous",
    vw: Math.max(0, Math.min(10000, Math.round(d.vw || 0))),
    resolved: false,
    replies: [],
  };
}
