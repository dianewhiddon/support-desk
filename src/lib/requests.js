/* Client-side request actions: open a request, reply, and flag a finished
   request. Files are validated and stored before the database write; a
   failed database write attempts cleanup. A process crash can still leave an orphan. */
import { appConfig } from './config.js';
import { nextTicketRef } from './ids.js';
import {
  createTicketWithAttachments,
  createMessageWithAttachments,
  getMessageByIdempotencyKey,
  getTicketBySubmissionKey,
  listSitesForClient,
  getSiteById,
  logEvent,
  emailOutboxStatement,
} from './db.js';
import { validateTicketFiles, storeTicketFiles, deleteStored, parseLinks } from './uploads.js';
import {
  newTicketEmailToOwner,
  requestReceivedEmailToClient,
  clientReplyEmailToOwner,
  feedbackFlagEmailToOwner,
} from './email.js';
import { sendTicketEmail } from './ticket-email.js';

export const MAX_BODY_CHARS = 12000;
const TYPES = new Set(['change', 'question']);

export function defaultTitle(type, body) {
  const clean = String(body).replace(/\s+/g, ' ').trim();
  const prefix = type === 'question' ? 'Question: ' : type === 'urgent' ? 'Urgent: ' : '';
  if (clean.length <= 64) return `${prefix}${clean}`;
  const clipped = clean
    .slice(0, 61)
    .replace(/\s+\S*$/, '')
    .trim();
  return `${prefix}${clipped || clean.slice(0, 61)}…`;
}

const VOICE_ONLY = '[Voice note attached.]';

/** Returns { ok, ref } or { ok:false, error } where error is a short code the form explains. */
export async function createRequest(
  env,
  { client, input, files, origin, ip = null, userAgent = null },
  deliver = sendTicketEmail,
) {
  const config = appConfig(env);
  const requested = TYPES.has(input.type) ? input.type : 'change';
  const type = requested === 'change' && input.emergency ? 'urgent' : requested;
  const submissionKey = String(input.submissionKey || '').trim();
  if (!submissionKey || submissionKey.length > 100) return { ok: false, error: 'expired' };
  const existing = await getTicketBySubmissionKey(env.DB, client.id, submissionKey);
  if (existing) return { ok: true, ref: existing.ref, replayed: true };

  const fileCheck = await validateTicketFiles(files);
  if (!fileCheck.ok) return { ok: false, error: fileCheck.reason };
  let body = String(input.body || '').trim();
  if (body.length > MAX_BODY_CHARS) return { ok: false, error: 'too_long' };
  if (!body && files.some((file) => String(file.type).startsWith('audio/'))) body = VOICE_ONLY;
  if (!body) return { ok: false, error: 'empty' };

  const sites = await listSitesForClient(env.DB, client.id);
  const chosen = Number.parseInt(String(input.siteId || ''), 10);
  const siteId = sites.some((site) => site.id === chosen) ? chosen : sites.length === 1 ? sites[0].id : null;
  const page =
    String(input.page || '')
      .trim()
      .slice(0, 200) || null;
  const links = parseLinks(input.links);

  const ref = await nextTicketRef(env.DB, config.ticketPrefix);
  const upload = await storeTicketFiles(env.UPLOADS, ref, files);
  if (!upload.ok) return { ok: false, error: 'attachments' };
  const title = defaultTitle(type, body);
  const ticket = { ref, client_id: client.id, type, title, body, page };
  const site = siteId ? await getSiteById(env.DB, siteId) : null;
  const deliveries = [
    {
      recipientEmail: config.ownerEmail,
      kind: 'new_request_owner',
      idempotencyKey: `new-request/${ref}`,
      payload: newTicketEmailToOwner(env, {
        ticket,
        client,
        site,
        links,
        attachments: upload.stored,
        adminUrl: new URL(`/admin/tickets/${ref}`, origin).toString(),
      }),
    },
    {
      recipientEmail: client.email,
      kind: 'request_received_client',
      idempotencyKey: `request-received/${ref}`,
      payload: requestReceivedEmailToClient(env, {
        ticket,
        client,
        url: new URL(`/tickets/${ref}`, origin).toString(),
      }),
    },
  ];
  try {
    ticket.id = await createTicketWithAttachments(env.DB, {
      ticket: { ref, clientId: client.id, siteId, type, title, body, page, links, submissionKey },
      attachments: upload.stored,
      deliveries,
    });
  } catch {
    await deleteStored(env.UPLOADS, upload.stored);
    const duplicate = await getTicketBySubmissionKey(env.DB, client.id, submissionKey);
    if (duplicate) return { ok: true, ref: duplicate.ref, replayed: true };
    return { ok: false, error: 'failed' };
  }
  await logEvent(env.DB, 'ticket_created', {
    ticketId: ticket.id,
    clientId: client.id,
    ip,
    userAgent,
    data: { type, attachmentCount: upload.stored.length, linkCount: links.length },
  });
  const notify = () => Promise.all(deliveries.map((delivery) => deliver(env, { ticket, ...delivery })));
  return { ok: true, ref, notify };
}

export async function addClientReply(
  env,
  { client, ticket, input, files, origin },
  deliver = sendTicketEmail,
) {
  const config = appConfig(env);
  const key = String(input.idempotencyKey || '').trim();
  if (!key || key.length > 100) return { ok: false, error: 'expired' };
  const messageKey = `client-reply/${ticket.id}/${key}`;
  if (await getMessageByIdempotencyKey(env.DB, messageKey)) return { ok: true, replayed: true };

  const fileCheck = await validateTicketFiles(files);
  if (!fileCheck.ok) return { ok: false, error: fileCheck.reason };
  let body = String(input.body || '').trim();
  if (body.length > MAX_BODY_CHARS) return { ok: false, error: 'too_long' };
  if (!body && files.some((file) => String(file.type).startsWith('audio/'))) body = VOICE_ONLY;
  if (!body) return { ok: false, error: 'empty' };
  const links = parseLinks(input.links);

  const upload = await storeTicketFiles(env.UPLOADS, ticket.ref, files);
  if (!upload.ok) return { ok: false, error: 'attachments' };
  const delivery = {
    recipientEmail: config.ownerEmail,
    kind: 'client_reply_owner',
    idempotencyKey: `client-reply-notify/${ticket.id}/${key}`,
    payload: clientReplyEmailToOwner(env, {
      ticket,
      client,
      message: body,
      links,
      attachments: upload.stored,
      adminUrl: new URL(`/admin/tickets/${ticket.ref}`, origin).toString(),
    }),
  };
  let message;
  try {
    message = await createMessageWithAttachments(env.DB, {
      message: {
        clientId: client.id,
        ticketId: ticket.id,
        author: 'client',
        body,
        visibility: 'client',
        idempotencyKey: messageKey,
        links,
      },
      attachments: upload.stored,
      deliveries: [delivery],
      ticketRef: ticket.ref,
      returnToOwner: true,
    });
  } catch {
    await deleteStored(env.UPLOADS, upload.stored);
    if (await getMessageByIdempotencyKey(env.DB, messageKey)) return { ok: true, replayed: true };
    return { ok: false, error: 'failed' };
  }
  await logEvent(env.DB, 'message', {
    ticketId: ticket.id,
    clientId: client.id,
    data: {
      author: 'client',
      messageId: message.id,
      attachmentCount: upload.stored.length,
      linkCount: links.length,
    },
  });
  const notify = () => deliver(env, { ticket, messageId: message.id, ...delivery });
  return { ok: true, notify };
}

/** "Yes, all good" is logged. "Something's off" reopens the request with the
    client's note in the conversation and tells the owner. */
export async function recordFeedback(env, { client, ticket, ok, note, origin }, deliver = sendTicketEmail) {
  const config = appConfig(env);
  const text = String(note || '')
    .trim()
    .slice(0, 2000);
  if (ticket.status !== 'done') return { ok: false };
  await logEvent(env.DB, 'feedback', {
    ticketId: ticket.id,
    clientId: client.id,
    data: { ok, note: text || null },
  });
  if (ok) return { ok: true };
  const key = `feedback/${ticket.id}/${ticket.revision}`;
  const delivery = {
    recipientEmail: config.ownerEmail,
    kind: 'feedback_owner',
    idempotencyKey: key,
    payload: feedbackFlagEmailToOwner(env, {
      ticket,
      client,
      note: text,
      adminUrl: new URL(`/admin/tickets/${ticket.ref}`, origin).toString(),
    }),
  };
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO messages (client_id, ticket_id, author, body, visibility, idempotency_key)
      SELECT client_id, id, 'client', ?, 'client', ? FROM tickets WHERE id = ? AND revision = ? AND status = 'done'`,
    ).bind(text || 'Something is off. Please check this request again.', key, ticket.id, ticket.revision),
    env.DB.prepare(
      `UPDATE tickets SET status = 'open', resolved_at = NULL, resolution_note = NULL,
      revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND revision = ? AND changes() = 1`,
    ).bind(ticket.id, ticket.revision),
    emailOutboxStatement(env.DB, ticket.ref, delivery, key),
  ]);
  if (!result[0].meta.changes) return { ok: true, replayed: true };
  const notify = () => deliver(env, { ticket, ...delivery });
  return { ok: true, notify };
}

/** Run slow follow-up work after the response when the platform allows it. */
export function afterResponse(context, task) {
  if (!task) return Promise.resolve();
  // Workers give background work about 30 seconds after the response is sent.
  const run = Promise.resolve()
    .then(task)
    .catch((error) => console.error('Background task failed', String(error)));
  const waitUntil = context.locals?.cfContext?.waitUntil;
  if (waitUntil) {
    waitUntil.call(context.locals.cfContext, run);
    return Promise.resolve();
  }
  return run;
}
