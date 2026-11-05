// GET  /api/items?page=/assembly   -> items for a page
// GET  /api/items?all=1            -> every open item on the site (for the overview)
// POST /api/items  {page, item}    -> create
import { json, cleanPage, sanitizeItem } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const stmt = url.searchParams.get("all")
    ? env.DB.prepare("SELECT id, page, data, created_at, updated_at FROM items WHERE deleted = 0 ORDER BY created_at")
    : env.DB.prepare("SELECT id, page, data, created_at, updated_at FROM items WHERE page = ? AND deleted = 0 ORDER BY created_at")
        .bind(cleanPage(url.searchParams.get("page")));
  const { results } = await stmt.all();
  return json(results.map((r) => ({ id: r.id, page: r.page, created: r.created_at, updated: r.updated_at, ...JSON.parse(r.data) })));
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const item = sanitizeItem(body.item);
  if (!item) return json({ error: "Invalid item" }, 400);
  const page = cleanPage(body.page);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO items (id, page, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, page, JSON.stringify(item), now, now).run();
  return json({ id, page, created: now, updated: now, ...item }, 201);
}
