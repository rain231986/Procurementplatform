PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STORE', 'WAREHOUSE', 'PURCHASING')),
  location_id TEXT,
  is_store_manager INTEGER NOT NULL DEFAULT 0 CHECK (is_store_manager IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx ON app_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  state_key TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  last_request_id TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES app_users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT REFERENCES app_users(id),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cloud_audit_logs_created_at_idx ON cloud_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS cloud_audit_logs_user_id_idx ON cloud_audit_logs(user_id);

INSERT OR IGNORE INTO app_users (
  id, username, display_name, role, location_id, is_store_manager, is_active, created_at, updated_at
) VALUES
  ('user_store01', 'store01', '民生門市 門市人員', 'STORE', 'store01', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store01_manager', 'store01_manager', '民生門市 店長', 'STORE', 'store01', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store02', 'store02', '中山門市 門市人員', 'STORE', 'store02', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store02_manager', 'store02_manager', '中山門市 店長', 'STORE', 'store02', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store03', 'store03', '板橋門市 門市人員', 'STORE', 'store03', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store03_manager', 'store03_manager', '板橋門市 店長', 'STORE', 'store03', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store04', 'store04', '台中門市 門市人員', 'STORE', 'store04', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store04_manager', 'store04_manager', '台中門市 店長', 'STORE', 'store04', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store05', 'store05', '高雄門市 門市人員', 'STORE', 'store05', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_store05_manager', 'store05_manager', '高雄門市 店長', 'STORE', 'store05', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_admin', 'admin', '系統管理者', 'ADMIN', NULL, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_warehouse', 'warehouse01', '總倉作業員', 'WAREHOUSE', 'warehouse', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_buyer', 'buyer01', '集中採購專員', 'PURCHASING', NULL, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
