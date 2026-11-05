// Checks a review backend against docs/API.md.
// Usage: node tests/contract.mjs <api-base-url> <passcode> [allowed-origin]
// It creates and then deletes a few test items, so point it at a test backend, not one a client is using.
const [base, key, origin] = process.argv.slice(2);
if (!base || !key) { console.error('Usage: node tests/contract.mjs <api-base-url> <passcode> [allowed-origin]'); process.exit(2); }
const B = base.replace(/\/+$/, '');
let failed = 0, passed = 0;
const ok = (cond, name, extra) => { if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); } };
const req = async (method, path, { body, k = key, headers = {} } = {}) => {
  const h = { ...headers };
  if (k != null) h['x-review-key'] = k;
  if (body) h['content-type'] = 'application/json';
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data, headers: r.headers };
};

console.log('Testing ' + B);
let r = await req('GET', '/auth', { k: 'definitely-wrong' });
ok(r.status === 401 && r.data && r.data.error, 'wrong passcode -> 401 with error', 'got ' + r.status);
r = await req('GET', '/auth', { k: null });
ok(r.status === 401, 'missing passcode -> 401', 'got ' + r.status);
r = await req('GET', '/auth', { k: '  ' + key.toUpperCase() + ' ' });
ok(r.status === 200 && r.data && r.data.ok === true, 'passcode is trimmed and case-insensitive', 'got ' + r.status);

const page = '/contract-test-' + Date.now();
r = await req('POST', '/items', { body: { page: page + '.html?x=1#y', item: { type: 'nope' } } });
ok(r.status === 400, 'invalid type -> 400', 'got ' + r.status);

r = await req('POST', '/items', { body: { page: page + '.html?x=1#y', item: {
  type: 'pin', anchor: { sel: 'body', fx: 0.5, fy: 'bad' }, points: [], color: 'red', text: 'x'.repeat(5000),
  author: '', vw: 99999, resolved: true, replies: [{ author: 'evil', text: 'injected' }], extra: 'drop me',
} } });
const a = r.data || {};
ok(r.status === 201, 'create -> 201', 'got ' + r.status);
ok(typeof a.id === 'string' && a.id.length > 0, 'create returns an id');
ok(a.page === page, 'page key is normalised (no .html, query or hash)', 'got ' + a.page);
ok(a.text && a.text.length === 4000, 'text is cut to 4000 characters');
ok(a.author === 'Anonymous', 'empty author -> Anonymous', 'got ' + a.author);
ok(a.color === '#e5484d', 'bad colour -> default', 'got ' + a.color);
ok(a.vw === 10000, 'vw is clamped to 10000', 'got ' + a.vw);
ok(a.anchor && a.anchor.fy === 0, 'non-numeric anchor -> 0');
ok(a.resolved === false && Array.isArray(a.replies) && a.replies.length === 0, 'resolved/replies cannot be set on create');
ok(!('extra' in a), 'unknown fields are dropped');
ok(typeof a.created === 'number' && a.created > 1e12, 'created is a millisecond timestamp');

r = await req('POST', '/items', { body: { page, item: { type: 'box', anchor: { sel: 'body' }, points: [[0.1, 0.1], [0.4, 0.5]], color: '#2f7cf6', text: '', author: 'Tester', vw: 800 } } });
const b = r.data || {};
ok(r.status === 201 && b.points && b.points.length === 2, 'create box with points');

r = await req('GET', '/items?page=' + encodeURIComponent(page));
ok(r.status === 200 && Array.isArray(r.data) && r.data.length === 2, 'list by page returns both', 'got ' + (r.data && r.data.length));
ok(r.data && r.data[0] && r.data[0].id === a.id, 'list is oldest first');
r = await req('GET', '/items?all=1');
ok(r.status === 200 && Array.isArray(r.data) && r.data.some(i => i.id === b.id), 'list all includes new items');

r = await req('PATCH', '/items/' + a.id, { body: { reply: { author: 'Alex', text: 'Done' } } });
ok(r.status === 200 && r.data.replies && r.data.replies.length === 1 && r.data.replies[0].author === 'Alex', 'reply is appended');
ok(r.data && r.data.page === page && r.data.created === a.created, 'patch returns the full item');
r = await req('PATCH', '/items/' + a.id, { body: { resolved: true, text: 'edited' } });
ok(r.status === 200 && r.data.resolved === true && r.data.text === 'edited', 'resolve and edit text');
r = await req('PATCH', '/items/does-not-exist', { body: { resolved: true } });
ok(r.status === 404, 'patch unknown id -> 404', 'got ' + r.status);

r = await req('DELETE', '/items/' + a.id);
ok(r.status === 200 && r.data && r.data.ok === true, 'delete -> ok');
await req('DELETE', '/items/' + b.id);
r = await req('GET', '/items?page=' + encodeURIComponent(page));
ok(r.status === 200 && r.data.length === 0, 'deleted items are not listed');
r = await req('PATCH', '/items/' + a.id, { body: { resolved: false } });
ok(r.status === 404, 'patch deleted item -> 404', 'got ' + r.status);

if (origin) {
  const pre = await fetch(B + '/items', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-review-key' } });
  ok(pre.status === 204 || pre.status === 200, 'CORS preflight from allowed origin', 'got ' + pre.status);
  ok(pre.headers.get('access-control-allow-origin') === origin, 'preflight echoes the allowed origin');
  ok((pre.headers.get('access-control-allow-headers') || '').toLowerCase().includes('x-review-key'), 'preflight allows x-review-key');
  r = await req('GET', '/auth', { headers: { origin } });
  ok(r.headers.get('access-control-allow-origin') === origin, 'normal response carries CORS header');
  const bad = await fetch(B + '/items', { method: 'OPTIONS', headers: { origin: 'https://not-allowed.example' } });
  ok(bad.headers.get('access-control-allow-origin') !== 'https://not-allowed.example', 'other origins are not allowed');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
