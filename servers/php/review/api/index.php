<?php
// Site Review Kit: PHP backend. One file, PHP 7.4+ with PDO SQLite (enabled on almost every host).
// Implements docs/API.md. Not yet run against tests/contract.mjs: test it before relying on it.
//
// Upload the whole `review/` folder to your site, so you get:
//   /review/review.js  /review/review.css  /review/api/index.php  /review/api/config.php
// Then add to your pages:  <script src="/review/review.js" data-api="/review/api" defer></script>
// No mod_rewrite? Use data-api="/review/api/index.php" instead.
declare(strict_types=1);

$config = is_file(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];
$passcode = strtolower(trim((string) (getenv('REVIEW_PASSCODE') ?: ($config['passcode'] ?? ''))));
$origins = array_filter(array_map(function ($s) { return rtrim(trim($s), '/'); },
  explode(',', (string) (getenv('ALLOWED_ORIGINS') ?: ($config['allowed_origins'] ?? '')))));
$dbFile = (string) (getenv('REVIEW_DB') ?: ($config['db'] ?? (__DIR__ . '/data/.ht.review.sqlite')));

/* ---------- response helpers ---------- */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$cors = $origin !== '' && in_array($origin, $origins, true);
function headers_common(bool $cors, string $origin): void {
  header('Cache-Control: no-store');
  header('X-Robots-Tag: noindex');
  if ($cors) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: content-type, x-review-key');
    header('Access-Control-Max-Age: 86400');
    header('Vary: Origin');
  }
}
function send(int $status, $body): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}
headers_common($cors, $origin);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code($cors ? 204 : 403); exit; }

/* ---------- passcode ---------- */
if ($passcode === '') send(503, ['error' => 'Review is not configured']);
$given = strtolower(trim((string) ($_SERVER['HTTP_X_REVIEW_KEY'] ?? '')));
if (!hash_equals($passcode, $given)) { usleep(800000); send(401, ['error' => 'Wrong passcode']); }

/* ---------- route: works with mod_rewrite (/review/api/items) or without (/review/api/index.php/items) ---------- */
$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$script = $_SERVER['SCRIPT_NAME'] ?? '';
if (!empty($_SERVER['PATH_INFO'])) $route = $_SERVER['PATH_INFO'];
elseif ($script !== '' && strpos($path, $script) === 0) $route = substr($path, strlen($script));
elseif (strpos($path, dirname($script)) === 0) $route = substr($path, strlen(rtrim(dirname($script), '/')));
else $route = $path;
$route = '/' . trim(rawurldecode($route), '/');

/* ---------- database ---------- */
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) send(500, ['error' => 'PHP needs the pdo_sqlite extension']);
try {
  if (!is_dir(dirname($dbFile))) @mkdir(dirname($dbFile), 0775, true);
  $db = new PDO('sqlite:' . $dbFile, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
  $db->exec('PRAGMA busy_timeout = 5000');
  $db->exec('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, page TEXT NOT NULL, data TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)');
  $db->exec('CREATE INDEX IF NOT EXISTS idx_items_page ON items (page, deleted)');
} catch (Throwable $e) {
  error_log('[review] ' . $e->getMessage());
  send(500, ['error' => 'Cannot open the database. Check that ' . basename(dirname($dbFile)) . '/ is writable.']);
}

/* ---------- validation (same rules as docs/API.md) ---------- */
function clip($s, int $n): string { return !is_string($s) ? '' : (function_exists('mb_substr') ? mb_substr($s, 0, $n, 'UTF-8') : substr($s, 0, $n)); }
function num($v): float { return (is_int($v) || is_float($v)) && is_finite((float) $v) ? round((float) $v, 4) : 0.0; }
function clean_page($p): string {
  $p = clip(is_string($p) && $p !== '' ? $p : '/', 200);
  $p = explode('#', explode('?', $p)[0])[0];
  if ($p === '' || $p === '/index.html') $p = '/';
  return preg_replace('/\.html$/', '', $p);
}
function sanitize_item($d): ?array {
  if (!is_array($d) || !in_array($d['type'] ?? null, ['pin', 'draw', 'box'], true)) return null;
  $a = is_array($d['anchor'] ?? null) ? $d['anchor'] : [];
  $points = [];
  if (is_array($d['points'] ?? null)) foreach (array_slice($d['points'], 0, 2000) as $p)
    $points[] = [num(is_array($p) ? ($p[0] ?? 0) : 0), num(is_array($p) ? ($p[1] ?? 0) : 0)];
  $author = clip($d['author'] ?? '', 60);
  return [
    'type' => $d['type'],
    'anchor' => ['sel' => clip($a['sel'] ?? '', 400), 'fx' => num($a['fx'] ?? 0), 'fy' => num($a['fy'] ?? 0)],
    'points' => $points,
    'color' => (is_string($d['color'] ?? null) && preg_match('/^#[0-9a-f]{6}$/i', $d['color'])) ? $d['color'] : '#e5484d',
    'text' => clip($d['text'] ?? '', 4000),
    'author' => $author !== '' ? $author : 'Anonymous',
    'vw' => max(0, min(10000, (int) round(is_numeric($d['vw'] ?? null) ? (float) $d['vw'] : 0))),
    'resolved' => false,
    'replies' => [],
  ];
}
function now_ms(): int { return (int) floor(microtime(true) * 1000); }
function uuid4(): string {
  $b = random_bytes(16); $b[6] = chr(ord($b[6]) & 0x0f | 0x40); $b[8] = chr(ord($b[8]) & 0x3f | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}
function row_to_item(array $r): array {
  $d = json_decode($r['data'], true) ?: [];
  $d['anchor'] = (object) ($d['anchor'] ?? []);
  return ['id' => $r['id'], 'page' => $r['page'], 'created' => (int) $r['created_at'], 'updated' => (int) $r['updated_at']] + $d;
}
function body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return [];
  $b = json_decode($raw, true);
  if (!is_array($b)) send(400, ['error' => 'Invalid JSON']);
  return $b;
}
$json = function (array $d): string { return json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION); };

/* ---------- routes ---------- */
try {
  if ($route === '/auth' && $method === 'GET') send(200, ['ok' => true]);

  if ($route === '/items') {
    if ($method === 'GET') {
      if (!empty($_GET['all'])) $q = $db->query('SELECT * FROM items WHERE deleted = 0 ORDER BY created_at, rowid');
      else { $q = $db->prepare('SELECT * FROM items WHERE page = ? AND deleted = 0 ORDER BY created_at, rowid'); $q->execute([clean_page($_GET['page'] ?? '/')]); }
      send(200, array_map('row_to_item', $q->fetchAll(PDO::FETCH_ASSOC)));
    }
    if ($method === 'POST') {
      $b = body();
      $item = sanitize_item($b['item'] ?? null);
      if (!$item) send(400, ['error' => 'Invalid item']);
      $id = uuid4(); $now = now_ms(); $page = clean_page($b['page'] ?? '/');
      $db->prepare('INSERT INTO items (id, page, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')->execute([$id, $page, $json($item), $now, $now]);
      send(201, row_to_item(['id' => $id, 'page' => $page, 'data' => $json($item), 'created_at' => $now, 'updated_at' => $now]));
    }
  }

  if (preg_match('#^/items/([^/]+)$#', $route, $m)) {
    $q = $db->prepare('SELECT * FROM items WHERE id = ? AND deleted = 0');
    $q->execute([$m[1]]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    if (!$row) send(404, ['error' => 'Not found']);
    $now = now_ms();
    if ($method === 'PATCH') {
      $b = body();
      $d = json_decode($row['data'], true) ?: [];
      if (is_string($b['text'] ?? null)) $d['text'] = clip($b['text'], 4000);
      if (is_bool($b['resolved'] ?? null)) $d['resolved'] = $b['resolved'];
      $reply = $b['reply'] ?? null;
      if (is_array($reply) && is_string($reply['text'] ?? null) && trim($reply['text']) !== '') {
        $d['replies'] = array_slice($d['replies'] ?? [], 0, 200);
        $ra = clip($reply['author'] ?? '', 60);
        $d['replies'][] = ['author' => $ra !== '' ? $ra : 'Anonymous', 'text' => clip($reply['text'], 4000), 'created' => $now];
      }
      $db->prepare('UPDATE items SET data = ?, updated_at = ? WHERE id = ?')->execute([$json($d), $now, $row['id']]);
      send(200, row_to_item(['data' => $json($d), 'updated_at' => $now] + $row));
    }
    if ($method === 'DELETE') {
      $db->prepare('UPDATE items SET deleted = 1, updated_at = ? WHERE id = ?')->execute([$now, $row['id']]);
      send(200, ['ok' => true]);
    }
  }
  send(404, ['error' => 'Not found']);
} catch (Throwable $e) {
  error_log('[review] ' . $e->getMessage());
  send(500, ['error' => 'Server error']);
}
