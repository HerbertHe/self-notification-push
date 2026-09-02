CREATE TABLE IF NOT EXISTS devices (
  device_key TEXT PRIMARY KEY NOT NULL,
  device_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_devices_updated_at
  ON devices(updated_at);
