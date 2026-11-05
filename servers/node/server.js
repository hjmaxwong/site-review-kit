#!/usr/bin/env node
// Site Review Kit: Node.js backend. Zero dependencies, Node 18+.
// Stores feedback in a JSON file. Implements docs/API.md.
//
// Run on its own:
//   REVIEW_PASSCODE=secret node server.js
//   It serves the API at /api, plus /review.js, /review.css and a /demo page.
//
// Or mount it in an existing Express / Connect app:
//   const { createReviewHandler } = require('./server.js');
//   app.use('/api', createReviewHandler({ passcode: process.env.REVIEW_PASSCODE }));
//
// Environment variables:
//   REVIEW_PASSCODE  required
//   PORT             default 8787
//   DATA_FILE        default ./data/review.json (use a persistent disk in production)
//   ALLOWED_ORIGINS  comma-separated, only when the website is on another domain
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- storage: one JSON file, written atomically, one write at a time ---------- */
function jsonStore(file) {
  file = path.resolve(file);
  let data = { items: [] };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(data.items)) data.items = []; }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read ' + file + ': ' + e.message); }
  let chain = Promise.resolve();
  const save = () => (chain = chain.then(async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data));
    await fs.promises.rename(tmp, file);
  }));
  return {
    list: (page) => data.items.filter((i) => !i.deleted && (page == null || i.page === page)).sort((a, b) => a.created - b.created),
    get: (id) => data.items.find((i) => i.id === id && !i.deleted) || null,
    insert: async (item) => { data.items.push(item); await save(); return item; },
    update: async (item) => { await save(); return item; },
  };
}

/* ---------- validation (same rules as docs/API.md) ---------- */
const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10000) / 10000 : 0);
const TYPES = new Set(['pin', 'draw', 'box']);
function cleanPage(p) {
  p = clip(p || '/', 200).split('?')[0].split('#')[0];
  if (p === '' || p === '/index.html') p = '/';
  return p.replace(/\.html$/, '');
}
function sanitizeItem(d) {
  if (!d || !TYPES.has(d.type)) return null;
  const anchor = d.anchor || {};
  return {
    type: d.type,
    anchor: { sel: clip(anchor.sel, 400), fx: num(anchor.fx), fy: num(anchor.fy) },
    points: Array.isArray(d.points) ? d.points.slice(0, 2000).map((p) => [num(p && p[0]), num(p && p[1])]) : [],
    color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#e5484d',
    text: clip(d.text, 4000),
    author: clip(d.author, 60) || 'Anonymous',
    vw: Math.max(0, Math.min(10000, Math.round(Number(d.vw) || 0))),
    resolved: false,
    replies: [],
  };
}
const publicItem = ({ deleted, ...i }) => i;
function same(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- the API handler: (req, res, next?) ---------- */
function createReviewHandler(opts = {}) {
  const passcode = String(opts.passcode || '').trim().toLowerCase();
  const origins = (Array.isArray(opts.allowedOrigins) ? opts.allowedOrigins : String(opts.allowedOrigins || '').split(','))
    .map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const store = opts.store || jsonStore(opts.dataFile || './data/review.json');

  return async function reviewHandler(req, res) {
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...cors, ...extra });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const origin = req.headers.origin;
    const cors = origin && origins.includes(origin) ? {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, x-review-key',
      'access-control-max-age': '86400',
      vary: 'Origin',
    } : {};
    try {
      if (req.method === 'OPTIONS') { res.writeHead(cors['access-control-allow-origin'] ? 204 : 403, cors); return res.end(); }
      if (!passcode) return send(503, { error: 'Review is not configured' });
      const given = String(req.headers['x-review-key'] || '').trim().toLowerCase();
      if (!same(given, passcode)) { await new Promise((r) => setTimeout(r, 800)); return send(401, { error: 'Wrong passcode' }); }

      const url = new URL(req.url, 'http://x');
      const route = url.pathname.replace(/\/+$/, '') || '/';
      const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : null;
      if (body === false) return send(400, { error: 'Invalid JSON' });

      if (route === '/auth' && req.method === 'GET') return send(200, { ok: true });

      if (route === '/items') {
        if (req.method === 'GET') {
          const page = url.searchParams.get('all') ? null : cleanPage(url.searchParams.get('page'));
          return send(200, store.list(page).map(publicItem));
        }
        if (req.method === 'POST') {
          const item = sanitizeItem(body && body.item);
          if (!item) return send(400, { error: 'Invalid item' });
          const now = Date.now();
          const saved = await store.insert({ id: crypto.randomUUID(), page: cleanPage(body.page), created: now, updated: now, ...item });
          return send(201, publicItem(saved));
        }
      }

      const m = route.match(/^\/items\/([^/]+)$/);
      if (m) {
        const it = store.get(decodeURIComponent(m[1]));
        if (!it) return send(404, { error: 'Not found' });
        if (req.method === 'PATCH') {
          if (typeof body.text === 'string') it.text = clip(body.text, 4000);
          if (typeof body.resolved === 'boolean') it.resolved = body.resolved;
          if (body.reply && typeof body.reply.text === 'string' && body.reply.text.trim()) {
            it.replies = (it.replies || []).slice(0, 200);
            it.replies.push({ author: clip(body.reply.author, 60) || 'Anonymous', text: clip(body.reply.text, 4000), created: Date.now() });
          }
          it.updated = Date.now();
          return send(200, publicItem(await store.update(it)));
        }
        if (req.method === 'DELETE') {
          it.deleted = true; it.updated = Date.now();
          await store.update(it);
          return send(200, { ok: true });
        }
      }
      return send(404, { error: 'Not found' });
    } catch (e) {
      console.error('[review]', e);
      return send(500, { error: 'Server error' });
    }
  };
}

function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body); // already parsed by express.json()
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { req.destroy(); resolve(false); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (_) { resolve(false); } });
    req.on('error', () => resolve(false));
  });
}

module.exports = { createReviewHandler, jsonStore, sanitizeItem, cleanPage };

/* ---------- standalone server ---------- */
if (require.main === module) {
  const api = createReviewHandler({
    passcode: process.env.REVIEW_PASSCODE,
    allowedOrigins: process.env.ALLOWED_ORIGINS,
    dataFile: process.env.DATA_FILE || path.join(__dirname, 'data', 'review.json'),
  });
  // Find the client files whether this folder sits inside the kit or was copied out with them.
  const find = (name) => [path.join(__dirname, name), path.join(__dirname, '..', '..', 'client', name), path.join(__dirname, '..', '..', 'demo', name)]
    .find((p) => fs.existsSync(p));
  const files = {
    '/review.js': [find('review.js'), 'text/javascript; charset=utf-8'],
    '/review.css': [find('review.css'), 'text/css; charset=utf-8'],
    '/demo': [find('index.html'), 'text/html; charset=utf-8'],
  };
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/api' || p.startsWith('/api/')) { req.url = req.url.slice(4) || '/'; return api(req, res); }
    const f = files[p.replace(/\/$/, '') || '/'];
    if (f && f[0]) {
      // review.js is loaded cross-origin from client sites, so allow that (it is a public file).
      res.writeHead(200, { 'content-type': f[1], 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' });
      return fs.createReadStream(f[0]).pipe(res);
    }
    res.writeHead(p === '/' ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' });
    res.end(p === '/' ? 'Site Review Kit API. Add <script src="/review.js" defer></script> to your site.' : 'Not found');
  });
  const port = Number(process.env.PORT) || 8787;
  server.listen(port, () => {
    console.log(`Site Review Kit running on http://localhost:${port}  (demo: /demo, API: /api)`);
    if (!process.env.REVIEW_PASSCODE) console.warn('Warning: REVIEW_PASSCODE is not set, so the API will refuse every request.');
  });
}
