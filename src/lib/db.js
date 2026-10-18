/* D1 queries. All table access goes through here or through the workflow
   modules that need multi-statement batches. */

export const OPEN_STATUSES = ['new', 'open', 'waiting'];
export const CLOSED_STATUSES = ['done', 'closed'];
export const isClosed = (ticket) => CLOSED_STATUSES.includes(ticket?.status);

// ---- events ----
export async function logEvent(db, type, { ticketId = null, clientId = null, ip = null, userAgent = null, data = null } = {}) {
  await db.prepare('INSERT INTO events (ticket_id, client_id, type, ip, user_agent, data) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(ticketId, clientId, type, ip, userAgent, data ? JSON.stringify(data) : null)
    .run();
}

// ---- clients ----
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export async function getClientByEmail(db, email) {
  return db.prepare('SELECT * FROM clients WHERE email = ? AND active = 1').bind(normalizeEmail(email)).first();
}
export async function getClientById(db, id) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
}
export async function listClients(db) {
  return (await db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM tickets t WHERE t.client_id = c.id AND t.status IN ('new','open','waiting')) AS open_count
    FROM clients c ORDER BY c.active DESC, COALESCE(c.name, c.email) COLLATE NOCASE
  `).all()).results;
}
export async function createClient(db, { email, name = null, company = null, timeZone = null }) {
  const result = await db.prepare('INSERT INTO clients (email, name, company, time_zone) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(normalizeEmail(email), name || null, company || null, timeZone || null).first();
  return result.id;
}
export async function updateClient(db, id, { email, name, company, timeZone, active }) {
  await db.prepare(`UPDATE clients SET email = ?, name = ?, company = ?, time_zone = ?, active = ?,
    updated_at = datetime('now') WHERE id = ?`)
    .bind(normalizeEmail(email), name || null, company || null, timeZone || null, active ? 1 : 0, id).run();
}

export async function updateClientAiNotes(db, id, notes) {
  await db.prepare("UPDATE clients SET ai_notes = ?, updated_at = datetime('now') WHERE id = ?").bind(notes || null, id).run();
}

// ---- sites ----
export async function listSitesForClient(db, clientId, { includeInactive = false } = {}) {
  return (await db.prepare(`SELECT * FROM sites WHERE client_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY id`)
    .bind(clientId).all()).results;
}
export async function getSiteById(db, id) {
  return db.prepare('SELECT * FROM sites WHERE id = ?').bind(id).first();
}
export async function createSite(db, { clientId, label, url }) {
  await db.prepare('INSERT INTO sites (client_id, label, url) VALUES (?, ?, ?)').bind(clientId, label || null, url || null).run();
}
export async function setSiteActive(db, { siteId, clientId, active }) {
  await db.prepare('UPDATE sites SET active = ? WHERE id = ? AND client_id = ?').bind(active ? 1 : 0, siteId, clientId).run();
}

// ---- tickets ----
export async function getTicketByRef(db, ref) {
  return db.prepare('SELECT * FROM tickets WHERE ref = ?').bind(String(ref || '')).first();
}
export async function getTicketBySubmissionKey(db, clientId, submissionKey) {
  if (!submissionKey) return null;
  return db.prepare('SELECT * FROM tickets WHERE client_id = ? AND submission_key = ?').bind(clientId, submissionKey).first();
}
export async function listTicketsForClient(db, clientId) {
  return (await db.prepare('SELECT * FROM tickets WHERE client_id = ? ORDER BY created_at DESC, id DESC').bind(clientId).all()).results;
}

/** The admin queue: every ticket with its client and site, plus whether a
    reply draft is waiting. Urgent first, then oldest, so nothing starves. */
export async function listQueue(db) {
  return (await db.prepare(`
    SELECT t.*, c.name AS client_name, c.company AS client_company, c.email AS client_email,
      s.label AS site_label, s.url AS site_url,
      EXISTS(SELECT 1 FROM reply_drafts d WHERE d.ticket_id = t.id AND d.status = 'ready' AND d.body <> '') AS has_draft,
      (SELECT d.source FROM reply_drafts d WHERE d.ticket_id = t.id AND d.status = 'ready' AND d.body <> '' LIMIT 1) AS draft_source,
      (SELECT MAX(m.created_at) FROM messages m WHERE m.ticket_id = t.id AND m.visibility = 'client') AS last_message_at
    FROM tickets t
    JOIN clients c ON c.id = t.client_id
    LEFT JOIN sites s ON s.id = t.site_id
    ORDER BY
      CASE WHEN t.status IN ('done','closed') THEN 1 ELSE 0 END,
      CASE WHEN t.status IN ('done','closed') THEN COALESCE(t.resolved_at, t.updated_at) END DESC,
      CASE WHEN t.type = 'urgent' THEN 0 ELSE 1 END,
      t.created_at ASC, t.id ASC
  `).all()).results;
}

/** Requests that need you: everything open except those waiting on the client. */
export async function countNeedsYou(db) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status IN ('new','open')").first();
  return Number(row?.n || 0);
}

export async function createTicketWithAttachments(db, { ticket, attachments = [] }) {
  const statements = [db.prepare(`
    INSERT INTO tickets (ref, client_id, site_id, type, title, body, page, links, submission_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ticket.ref, ticket.clientId, ticket.siteId || null, ticket.type, ticket.title, ticket.body,
    ticket.page || null, ticket.links?.length ? JSON.stringify(ticket.links) : null, ticket.submissionKey || null,
  )];
  for (const item of attachments) {
    statements.push(db.prepare(`
      INSERT INTO ticket_attachments (ticket_id, r2_key, filename, content_type, size)
      SELECT id, ?, ?, ?, ? FROM tickets WHERE ref = ?
    `).bind(item.key, item.filename || null, item.contentType || null, item.size || null, ticket.ref));
  }
  const results = await db.batch(statements);
  return results[0].meta.last_row_id;
}

/** Client activity moves a ticket back to you. Closed tickets reopen. */
export async function returnTicketToOwner(db, ticketId) {
  await db.prepare(`UPDATE tickets SET status = CASE WHEN status = 'new' THEN 'new' ELSE 'open' END,
    resolved_at = NULL, revision = revision + 1, updated_at = datetime('now') WHERE id = ?`).bind(ticketId).run();
}

// ---- messages ----
export async function getMessageByIdempotencyKey(db, idempotencyKey) {
  return db.prepare('SELECT * FROM messages WHERE idempotency_key = ?').bind(idempotencyKey).first();
}
export async function listMessages(db, ticketId) {
  return (await db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC').bind(ticketId).all()).results;
}
export async function createMessageWithAttachments(db, { message, attachments = [] }) {
  if (!message.idempotencyKey) throw new Error('A message needs an idempotency key.');
  const statements = [db.prepare(`
    INSERT INTO messages (client_id, ticket_id, author, body, visibility, idempotency_key, links)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    message.clientId, message.ticketId, message.author, message.body, message.visibility || 'client',
    message.idempotencyKey, message.links?.length ? JSON.stringify(message.links) : null,
  )];
  for (const item of attachments) {
    statements.push(db.prepare(`
      INSERT INTO ticket_attachments (ticket_id, message_id, r2_key, filename, content_type, size)
      SELECT ?, id, ?, ?, ?, ? FROM messages WHERE idempotency_key = ?
    `).bind(message.ticketId, item.key, item.filename || null, item.contentType || null, item.size || null, message.idempotencyKey));
  }
  await db.batch(statements);
  return getMessageByIdempotencyKey(db, message.idempotencyKey);
}

// ---- attachments ----
/** Everything except private reply-draft files. */
export async function listAttachments(db, ticketId) {
  return (await db.prepare("SELECT * FROM ticket_attachments WHERE ticket_id = ? AND COALESCE(role,'') NOT IN ('reply_draft','reply_removed') ORDER BY id")
    .bind(ticketId).all()).results;
}

// ---- reply drafts ----
export async function getDraftById(db, id) {
  return db.prepare('SELECT * FROM reply_drafts WHERE id = ?').bind(id).first();
}
/** The one editable draft: ready, still being written by AI, or a failed AI attempt. */
export async function openDraftForTicket(db, ticketId) {
  return db.prepare("SELECT * FROM reply_drafts WHERE ticket_id = ? AND status IN ('pending','ready','error') ORDER BY id DESC LIMIT 1").bind(ticketId).first();
}

// ---- durable email delivery ----
export async function prepareEmailDelivery(db, { clientId, ticketId, messageId = null, kind, recipientEmail, subject, payload, idempotencyKey }) {
  await db.prepare(`
    INSERT OR IGNORE INTO email_deliveries
      (client_id, ticket_id, message_id, kind, recipient_email, subject, payload_json, status, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).bind(clientId, ticketId, messageId, kind, recipientEmail, subject, JSON.stringify(payload), idempotencyKey).run();
  return db.prepare('SELECT * FROM email_deliveries WHERE idempotency_key = ?').bind(idempotencyKey).first();
}

/** Claim a delivery for sending. A stuck "sending" claim expires after ten minutes. */
export async function claimEmailDelivery(db, id) {
  const result = await db.prepare(`
    UPDATE email_deliveries SET status = 'sending', attempt_count = attempt_count + 1,
      claimed_at = datetime('now'), updated_at = datetime('now'), last_error = NULL
    WHERE id = ? AND (status IN ('pending','failed') OR (status = 'sending' AND claimed_at < datetime('now', '-10 minutes')))
  `).bind(id).run();
  return { ok: result.meta.changes === 1, row: await getEmailDelivery(db, id) };
}
export async function markEmailAccepted(db, id, providerMessageId) {
  await db.prepare(`UPDATE email_deliveries SET status = 'accepted', provider_message_id = ?,
    accepted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(providerMessageId, id).run();
}
export async function markEmailFailed(db, id, detail) {
  await db.prepare("UPDATE email_deliveries SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(String(detail || 'Email delivery failed.').slice(0, 500), id).run();
}
export async function getEmailDelivery(db, id) {
  return db.prepare('SELECT * FROM email_deliveries WHERE id = ?').bind(id).first();
}
export async function listEmailDeliveries(db, ticketId) {
  return (await db.prepare('SELECT * FROM email_deliveries WHERE ticket_id = ? ORDER BY id').bind(ticketId).all()).results;
}

const STATUS_ORDER = `CASE %s WHEN 'pending' THEN 0 WHEN 'sending' THEN 1 WHEN 'accepted' THEN 2
  WHEN 'delayed' THEN 3 WHEN 'delivered' THEN 4 WHEN 'failed' THEN 5 WHEN 'bounced' THEN 6
  WHEN 'complained' THEN 7 ELSE 0 END`;

/** Apply a provider webhook once. Status only moves forward, so a late
    "sent" event never overwrites "delivered". */
export async function recordEmailProviderEvent(db, { svixId, eventType, emailId, eventAt, status, detail = null }) {
  const event = await db.prepare('INSERT OR IGNORE INTO email_webhook_events (svix_id, event_type, email_id, event_at) VALUES (?, ?, ?, ?)')
    .bind(svixId, eventType || null, emailId || null, eventAt || null).run();
  if (!event.meta.changes || !emailId) return false;
  const delivered = status === 'delivered' ? ", delivered_at = COALESCE(delivered_at, datetime('now'))" : '';
  await db.prepare(`
    UPDATE email_deliveries SET status = ?, last_error = ?, provider_event_at = ?, updated_at = datetime('now') ${delivered}
    WHERE provider_message_id = ? AND ${STATUS_ORDER.replace('%s', 'status')} <= ${STATUS_ORDER.replace('%s', '?')}
  `).bind(status, detail, eventAt || null, emailId, status).run();
  return true;
}

// ---- sign-in ----
export async function gcAuthTables(db) {
  await db.batch([
    db.prepare("DELETE FROM magic_tokens WHERE expires_at < datetime('now', '-1 day')"),
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
  ]);
}
export async function createMagicToken(db, { token, clientId = null, adminEmail = null, expiresAt }) {
  await db.prepare('INSERT INTO magic_tokens (token, client_id, admin_email, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, clientId, adminEmail, expiresAt).run();
}
/** Single use: the conditional UPDATE is the lock, so a token replayed in a
    race opens at most one session. */
export async function consumeMagicToken(db, token) {
  const row = await db.prepare('SELECT * FROM magic_tokens WHERE token = ?').bind(String(token || '')).first();
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
  const result = await db.prepare("UPDATE magic_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL").bind(row.id).run();
  if (!result.meta.changes) return null;
  return { clientId: row.client_id, adminEmail: row.admin_email };
}
export async function createSession(db, { id, clientId = null, adminEmail = null, expiresAt }) {
  await db.prepare('INSERT INTO sessions (id, client_id, admin_email, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, clientId, adminEmail, expiresAt).run();
}
export async function getSession(db, id) {
  const row = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(String(id || '')).first();
  if (!row || new Date(row.expires_at) < new Date()) return null;
  return row;
}
export async function deleteSession(db, id) {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}
