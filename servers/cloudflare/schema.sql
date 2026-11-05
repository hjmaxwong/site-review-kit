-- Review-mode comments, drawings and highlight boxes
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  page        TEXT NOT NULL,
  data        TEXT NOT NULL,          -- JSON: type, anchor, points, text, author, color, resolved, replies
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_page ON items (page, deleted);
