CREATE TABLE IF NOT EXISTS authorization (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL,
  time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  device_key TEXT,
  initialized INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry
  ON sessions(last_seen, created_at);
