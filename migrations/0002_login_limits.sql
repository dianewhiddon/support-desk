-- Atomic rate limits supplement the audit trail, without storing raw addresses.
CREATE TABLE login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_login_limits_expiry ON login_limits(expires_at);
