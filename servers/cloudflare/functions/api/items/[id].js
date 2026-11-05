// Update one item: edit its text, resolve or reopen it, or add a reply.
// Remove one item (soft delete: the row is kept with deleted = 1).
import { json, clip } from "../_shared.js";

async function load(env, id) {
  const row = await env.DB.prepare("SELECT page, data, created_at FROM items WHERE id = ? AND deleted = 0").bind(id).first();
  return row ? { row, data: JSON.parse(row.data) } : null;
}

export async function onRequestPatch({ request, env, params }) {
  const found = await load(env, params.id);
  if (!found) return json({ error: "Not found" }, 404);
  const { row, data } = found;
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (typeof body.text === "string") data.text = clip(body.text, 4000);
  if (typeof body.resolved === "boolean") data.resolved = body.resolved;
  if (body.reply && typeof body.reply.text === "string" && body.reply.text.trim()) {
    data.replies = (data.replies || []).slice(0, 200);
    data.replies.push({ author: clip(body.reply.author, 60) || "Anonymous", text: clip(body.reply.text, 4000), created: Date.now() });
  }
  const now = Date.now();
  await env.DB.prepare("UPDATE items SET data = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(data), now, params.id).run();
  return json({ id: params.id, page: row.page, created: row.created_at, updated: now, ...data });
}

export async function onRequestDelete({ env, params }) {
  if (!(await load(env, params.id))) return json({ error: "Not found" }, 404);
  await env.DB.prepare("UPDATE items SET deleted = 1, updated_at = ? WHERE id = ?").bind(Date.now(), params.id).run();
  return json({ ok: true });
}
