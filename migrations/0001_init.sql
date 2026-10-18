-- Support desk schema. Apply with:
--   npx wrangler d1 migrations apply DB --local    (local)
--   npx wrangler d1 migrations apply DB --remote   (production)

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  time_zone TEXT,
  -- Your notes about this client for AI drafts: their business, offer, voice,
  -- site and history with you. Clients never see this.
  ai_notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Optional: the websites a client can ask about. One site is chosen
-- automatically; two or more add a "Which site?" picker to the request form.
CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  label TEXT,
  url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sites_client ON sites(client_id);

-- status: new (just arrived) | open (back with you after a client reply or
-- reopen) | waiting (waiting on the client) | done (resolved) | closed (dismissed)
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  site_id INTEGER REFERENCES sites(id),
  type TEXT NOT NULL DEFAULT 'change' CHECK (type IN ('change', 'question', 'urgent')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  page TEXT,
  links TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'open', 'waiting', 'done', 'closed')),
  resolution_note TEXT,
  closure_reason TEXT,
  duplicate_of_ticket_id INTEGER REFERENCES tickets(id),
  submission_key TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX idx_tickets_status ON tickets(status, created_at);
CREATE INDEX idx_tickets_client ON tickets(client_id, created_at);
CREATE UNIQUE INDEX idx_tickets_submission ON tickets(client_id, submission_key) WHERE submission_key IS NOT NULL;

-- author: client | owner. visibility: client (in the conversation) | internal
-- (a private note only admins see).
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  author TEXT NOT NULL CHECK (author IN ('client', 'owner')),
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'client' CHECK (visibility IN ('client', 'internal')),
  links TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_ticket ON messages(ticket_id, created_at);
CREATE UNIQUE INDEX idx_messages_idempotency ON messages(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- One editable reply draft per open ticket. Sending consumes it atomically.
-- status: pending (AI is writing it) | ready | error (AI draft failed) | sent | discarded
-- source: owner (you wrote or saved it) | ai (written by AI, not yet edited)
CREATE TABLE reply_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready', 'error', 'sent', 'discarded')),
  source TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner', 'ai')),
  model TEXT,
  error TEXT,
  sent_message_id INTEGER REFERENCES messages(id),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_reply_drafts_open ON reply_drafts(ticket_id) WHERE status IN ('pending', 'ready', 'error');

-- role: NULL (client upload) | reply_draft (private, attached to an unsent
-- reply) | reply_removed (private tombstone) | reply_sent (published with a reply)
CREATE TABLE ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  message_id INTEGER REFERENCES messages(id),
  r2_key TEXT NOT NULL,
  filename TEXT,
  content_type TEXT,
  size INTEGER,
  role TEXT CHECK (role IS NULL OR role IN ('reply_draft', 'reply_removed', 'reply_sent')),
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_ticket ON ticket_attachments(ticket_id);
CREATE INDEX idx_attachments_message ON ticket_attachments(message_id);

-- One durable, idempotent record per notification email.
CREATE TABLE email_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  message_id INTEGER REFERENCES messages(id),
  kind TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'accepted', 'delivered', 'delayed', 'bounced', 'complained', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TEXT,
  accepted_at TEXT,
  delivered_at TEXT,
  provider_event_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_deliveries_ticket ON email_deliveries(ticket_id, created_at);
CREATE INDEX idx_email_deliveries_status ON email_deliveries(status, updated_at);

CREATE TABLE email_webhook_events (
  svix_id TEXT PRIMARY KEY,
  event_type TEXT,
  email_id TEXT,
  event_at TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sign-in. A session belongs to a client OR an admin email, never both.
CREATE TABLE magic_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  client_id INTEGER REFERENCES clients(id),
  admin_email TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((client_id IS NULL) <> (admin_email IS NULL))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  admin_email TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((client_id IS NULL) <> (admin_email IS NULL))
);

CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Audit trail: sign-ins (also the sign-in rate limit), request activity,
-- emails and admin state changes.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER,
  client_id INTEGER,
  type TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  data TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_ticket ON events(ticket_id, id);
CREATE INDEX idx_events_type_ip ON events(type, ip, at);
