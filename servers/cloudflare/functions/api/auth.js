// GET /api/auth -> 200 when the passcode (checked in _middleware.js) is correct
import { json } from "./_shared.js";
export const onRequestGet = () => json({ ok: true });
