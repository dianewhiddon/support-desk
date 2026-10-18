/* Admin actions on a request. Every write is guarded by the revision the
   admin saw, so two tabs (or two people) can never silently overwrite each
   other: a stale form gets a clear "this changed" error and keeps its text. */
import { getTicketByRef, openDraftForTicket, getMessageByIdempotencyKey, logEvent, isClosed } from './db.js';
import { listReplyFiles } from './reply-files.js';
import { replyEmailToClient } from './email.js';
import { sendTicketEmail } from './ticket-email.js';

const failure = (error, status = 409) => ({ ok: false, error, status });
export const MAX_MESSAGE_CHARS = 12000;

/** Create or update the single editable reply draft for a request.
    An empty first save is refused unless it opens a draft for file uploads. */
export async function saveReplyDraft(db, ticket, { body, draftId, expectedRevision, ticketRevision = ticket.revision, forFiles = false }) {
  const text = String(body ?? '').trim();
  if (text.length > MAX_MESSAGE_CHARS) return failure('Write a reply of up to 12,000 characters.', 400);
  if (!text && !draftId && !forFiles) return failure('Write a message first.', 400);
  if (isClosed(ticket)) return failure('Reopen this request before editing its reply.');
  if (!Number.isInteger(ticketRevision) || ticketRevision !== ticket.revision) return failure('This request changed. Your text is still here. Reload before saving.');
  const current = await openDraftForTicket(db, ticket.id);
  if (current && (Number(draftId) !== current.id || Number(expectedRevision) !== current.revision)) {
    return failure('This draft changed in another window. Your text is still here. Reload the saved draft before replacing it.');
  }
  if (!current && draftId) return failure('This draft is no longer editable. Your text is still here.');
  const ticketOpen = 'EXISTS (SELECT 1 FROM tickets WHERE id = ? AND revision = ? AND status NOT IN (\'done\',\'closed\'))';
  const saved = current
    ? await db.prepare(`UPDATE reply_drafts SET body = ?, status = 'ready', source = 'owner', error = NULL, revision = revision + 1, updated_at = datetime('now')
        WHERE id = ? AND revision = ? AND status IN ('pending','ready','error') AND ${ticketOpen} RETURNING *`)
      .bind(text, current.id, current.revision, ticket.id, ticketRevision).first()
    : await db.prepare(`INSERT INTO reply_drafts (client_id, ticket_id, body)
        SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM reply_drafts WHERE ticket_id = ? AND status IN ('pending','ready','error')) AND ${ticketOpen} RETURNING *`)
      .bind(ticket.client_id, ticket.id, text, ticket.id, ticket.id, ticketRevision).first();
  if (!saved) return failure('This draft changed in another window. Your text is still here.');
  return { ok: true, status: 200, draft: { id: saved.id, revision: saved.revision, body: saved.body } };
}

export const composerMessageKey = (ticketId, action, key) => `admin/${ticketId}/${action}/${key}`;

const SEND_AFTER = { waiting: 'waiting', done: 'done' };

/** Send the saved draft to the client, or save a private note.
    Sending is one atomic batch: insert the message (only if the ticket and
    draft are exactly as the admin saw them), publish the draft's files onto
    it, consume the draft, and move the request to its next status. The
    client email goes out afterwards and is retried from its durable record. */
export async function applyComposerAction(env, origin, {
  ticket, client, action, body, idempotencyKey, draftId = null, draftRevision = null, after = 'waiting', resolutionNote = '',
}, deliver = sendTicketEmail) {
  if (!['send_reply', 'save_note'].includes(action)) return failure('Choose what should happen with this message.', 400);
  const text = String(body || '').trim();
  if (text.length > MAX_MESSAGE_CHARS) return failure('Write a message of up to 12,000 characters.', 400);
  const key = String(idempotencyKey || '').trim();
  if (!key || key.length > 100) return failure('This form expired. Your text is still here. Reload before trying again.', 400);
  if (!ticket?.id || Number(client?.id) !== Number(ticket.client_id)) return failure('This client does not match the request.');
  const sending = action === 'send_reply';
  const visibility = sending ? 'client' : 'internal';
  const nextStatus = sending ? (SEND_AFTER[after] || 'waiting') : null;
  const messageKey = composerMessageKey(ticket.id, action, key);

  let message = await getMessageByIdempotencyKey(env.DB, messageKey);
  let created = false;
  if (!message) {
    if (isClosed(ticket)) return failure('Reopen the request before adding a message.');
    if (sending && (!Number.isInteger(draftId) || !Number.isInteger(draftRevision))) return failure('Save this draft before sending it.');
    if (!text && !(sending && (await listReplyFiles(env.DB, ticket.id, draftId)).length)) return failure('Write a message or attach a file first.', 400);
    const draftGuard = sending
      ? " AND EXISTS (SELECT 1 FROM reply_drafts d WHERE d.id = ? AND d.ticket_id = tickets.id AND d.revision = ? AND d.status = 'ready' AND d.body = ?)"
      : '';
    const statements = [env.DB.prepare(`INSERT OR IGNORE INTO messages (client_id, ticket_id, author, body, visibility, idempotency_key)
      SELECT client_id, id, 'owner', ?, ?, ? FROM tickets WHERE id = ? AND revision = ? AND status NOT IN ('done','closed')${draftGuard}`)
      .bind(text, visibility, messageKey, ticket.id, ticket.revision, ...(sending ? [draftId, draftRevision, text] : []))];
    if (sending) {
      const sent = '(SELECT id FROM messages WHERE idempotency_key = ?)';
      statements.push(
        env.DB.prepare(`UPDATE ticket_attachments SET message_id = ${sent}, role = 'reply_sent'
          WHERE ticket_id = ? AND role = 'reply_draft' AND json_extract(metadata_json, '$.draft_id') = ? AND ${sent} IS NOT NULL`)
          .bind(messageKey, ticket.id, draftId, messageKey),
        env.DB.prepare(`UPDATE reply_drafts SET status = 'sent', sent_message_id = ${sent}, revision = revision + 1, updated_at = datetime('now')
          WHERE id = ? AND revision = ? AND status = 'ready' AND ${sent} IS NOT NULL`)
          .bind(messageKey, draftId, draftRevision, messageKey),
        env.DB.prepare(`UPDATE tickets SET status = ?, resolved_at = ${nextStatus === 'done' ? "datetime('now')" : 'NULL'},
          resolution_note = COALESCE(?, resolution_note), revision = revision + 1, updated_at = datetime('now')
          WHERE id = ? AND revision = ? AND ${sent} IS NOT NULL`)
          .bind(nextStatus, nextStatus === 'done' ? String(resolutionNote || '').trim().slice(0, 4000) || null : null, ticket.id, ticket.revision, messageKey),
      );
    }
    const results = await env.DB.batch(statements);
    created = !!results[0].meta.changes;
    message = await getMessageByIdempotencyKey(env.DB, messageKey);
    if (!message) return failure('The request or draft changed before this was saved. Your text is still here. Reload before trying again.');
  }
  if (message.ticket_id !== ticket.id || message.author !== 'owner' || message.visibility !== visibility || message.body !== text) {
    return failure('This form already saved different text. Reload before sending another message.');
  }

  let delivery = null;
  if (sending) {
    const url = new URL(`/tickets/${ticket.ref}`, origin).toString();
    const attachments = (await env.DB.prepare('SELECT id, filename FROM ticket_attachments WHERE ticket_id = ? AND message_id = ? ORDER BY id')
      .bind(ticket.id, message.id).all()).results;
    try {
      delivery = await deliver(env, {
        ticket, messageId: message.id, recipientEmail: client.email, kind: 'reply',
        payload: replyEmailToClient(env, { ticket, client, url, attachments, waiting: nextStatus === 'waiting' }),
        idempotencyKey: `reply/${ticket.id}/${message.id}`,
      });
    } catch {
      delivery = { ok: false, detail: 'The reply is saved, but its email could not be confirmed.' };
    }
  }
  if (created) {
    await logEvent(env.DB, 'message', { ticketId: ticket.id, clientId: ticket.client_id, data: { author: 'owner', visibility, messageId: message.id, status: nextStatus } });
  }
  return { ok: true, status: 200, messageId: message.id, delivery, replayed: !created };
}

const ACTION_STATUS = { resolve: 'done', dismiss: 'closed', waiting: 'waiting', reopen: 'open' };

/** Resolve, dismiss (not needed or duplicate), mark waiting, or reopen. Sends no message. */
export async function changeRequestState(db, ref, { action, expectedRevision, reason = '', note = '', duplicateRef = '' }) {
  const ticket = await getTicketByRef(db, ref);
  if (!ticket) return failure('Request not found.', 404);
  if (!ACTION_STATUS[action]) return failure('Choose a request action.', 400);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== ticket.revision) return failure('This request changed. Reload before continuing.');
  const closed = isClosed(ticket);
  if ((action === 'reopen') !== closed) return failure(closed ? 'This request is closed. Reopen it first.' : 'This request is already open.');
  if (action === 'waiting' && ticket.status === 'waiting') return failure('This request is already waiting on the client.');
  if (action === 'dismiss' && !['duplicate', 'not_needed'].includes(reason)) {
    return failure('Use Resolve for finished work. Dismiss only duplicates or requests that are no longer needed.', 400);
  }
  let duplicate = null;
  if (action === 'dismiss' && reason === 'duplicate') {
    duplicate = await getTicketByRef(db, String(duplicateRef).trim());
    if (!duplicate || duplicate.id === ticket.id || duplicate.client_id !== ticket.client_id || duplicate.duplicate_of_ticket_id) {
      return failure('Choose the original request from the same client.', 400);
    }
  }
  const text = String(note).trim().slice(0, 4000);
  const status = ACTION_STATUS[action];
  const terminal = status === 'done' || status === 'closed';
  const result = await db.prepare(`UPDATE tickets SET status = ?, closure_reason = ?, duplicate_of_ticket_id = ?,
      resolution_note = ?, resolved_at = ${terminal ? "datetime('now')" : 'NULL'},
      revision = revision + 1, updated_at = datetime('now')
    WHERE id = ? AND revision = ?`)
    .bind(status, action === 'dismiss' ? reason : null, duplicate?.id || null, text || (action === 'reopen' ? null : ticket.resolution_note),
      ticket.id, expectedRevision).run();
  if (!result.meta.changes) return failure('This request changed. Reload before continuing.');
  await logEvent(db, 'request_state', {
    ticketId: ticket.id, clientId: ticket.client_id,
    data: { action, reason: reason || null, note: text || null, duplicateRef: duplicate?.ref || null, previousStatus: ticket.status },
  });
  return { ok: true, status: 200, action };
}

export async function listRequestHistory(db, ticketId) {
  return (await db.prepare("SELECT data, at FROM events WHERE ticket_id = ? AND type = 'request_state' ORDER BY id DESC LIMIT 30")
    .bind(ticketId).all()).results.map((row) => ({ at: row.at, data: JSON.parse(row.data || '{}') }));
}

