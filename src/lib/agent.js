/* Agent API: lets your own AI coding agent (Claude Code, for example) read the
   queue, download request files, leave a private note and prepare a reply
   draft. When you approve a saved draft in chat, the agent can send exactly
   that draft through the desk's own Send step, and resolve, dismiss, mark
   waiting or reopen with the same guards as the desk. It can never send text
   that differs from the saved draft. Authenticated with the AGENT_TOKEN
   secret. No AGENT_TOKEN, no agent API. */
import {
  getTicketByRef,
  getClientById,
  getSiteById,
  listMessages,
  listAttachments,
  openDraftForTicket,
  isClosed,
  logEvent,
  getMessageByIdempotencyKey,
} from './db.js';
import { parseLinksJson } from './render.js';
import { applyComposerAction, changeRequestState, composerMessageKey } from './workflow.js';
import { sendTicketEmail } from './ticket-email.js';

const encoder = new TextEncoder();

/** Constant-time comparison of the bearer token. */
export function isAgentRequest(request, env) {
  const expected = String(env.AGENT_TOKEN || '');
  if (expected.length < 32) return false;
  const header = request.headers.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = encoder.encode(supplied);
  const b = encoder.encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < b.length; i += 1) difference |= (a[i] ?? 0) ^ b[i];
  return difference === 0;
}

export async function listOpenRequests(db) {
  return (
    await db
      .prepare(
        `
    SELECT t.ref, t.type, t.title, t.status, t.page, t.created_at, t.updated_at,
      c.name AS client_name, c.company AS client_company, s.label AS site_label, s.url AS site_url
    FROM tickets t JOIN clients c ON c.id = t.client_id LEFT JOIN sites s ON s.id = t.site_id
    WHERE t.status IN ('new','open','waiting')
    ORDER BY CASE WHEN t.type = 'urgent' THEN 0 ELSE 1 END, t.created_at ASC
  `,
      )
      .all()
  ).results;
}

export async function requestForAgent(db, ref, origin) {
  const ticket = await getTicketByRef(db, ref);
  if (!ticket) return null;
  const [client, site, messages, attachments, draft] = await Promise.all([
    getClientById(db, ticket.client_id),
    ticket.site_id ? getSiteById(db, ticket.site_id) : null,
    listMessages(db, ticket.id),
    listAttachments(db, ticket.id),
    openDraftForTicket(db, ticket.id),
  ]);
  const file = (item) => ({
    id: item.id,
    filename: item.filename,
    content_type: item.content_type,
    size: item.size,
    url: new URL(`/api/agent/files/${item.id}`, origin).toString(),
  });
  return {
    ref: ticket.ref,
    revision: ticket.revision,
    type: ticket.type,
    status: ticket.status,
    title: ticket.title,
    page: ticket.page,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    client: {
      name: client?.name || null,
      company: client?.company || null,
      time_zone: client?.time_zone || null,
      notes: client?.ai_notes || null,
    },
    site: site ? { label: site.label, url: site.url } : null,
    request: {
      body: ticket.body,
      links: parseLinksJson(ticket.links),
      files: attachments.filter((a) => !a.message_id).map(file),
    },
    conversation: messages.map((message) => ({
      author: message.author,
      private_note: message.visibility === 'internal',
      body: message.body,
      created_at: message.created_at,
      links: parseLinksJson(message.links),
      files: attachments.filter((a) => a.message_id === message.id).map(file),
    })),
    draft: draft
      ? {
          id: draft.id,
          revision: draft.revision,
          status: draft.status,
          source: draft.source,
          body: draft.body,
        }
      : null,
  };
}

/** Save a prepared reply as the draft. It shows in the editor as drafted by AI.
    Replacing an existing draft requires the revision you last read. */
export async function saveAgentDraft(db, ref, { body, expectedRevision = null }) {
  const ticket = await getTicketByRef(db, ref);
  if (!ticket) return { ok: false, status: 404, error: 'Request not found.' };
  if (isClosed(ticket)) return { ok: false, status: 409, error: 'This request is closed.' };
  const text = String(body ?? '').trim();
  if (!text || text.length > 12000)
    return { ok: false, status: 400, error: 'Send a draft body of 1 to 12,000 characters.' };
  const current = await openDraftForTicket(db, ticket.id);
  let saved;
  if (current) {
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
      return {
        ok: false,
        status: 409,
        error: 'A draft already exists. Read the request again and send its draft.revision to replace it.',
      };
    }
    saved = await db
      .prepare(
        `UPDATE reply_drafts SET body = ?, status = 'ready', source = 'ai', model = 'agent', error = NULL,
        revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND revision = ? AND status IN ('pending','ready','error') RETURNING *`,
      )
      .bind(text, current.id, current.revision)
      .first();
  } else {
    saved = await db
      .prepare(
        `INSERT INTO reply_drafts (client_id, ticket_id, body, status, source, model)
        SELECT ?, ?, ?, 'ready', 'ai', 'agent' WHERE NOT EXISTS (SELECT 1 FROM reply_drafts WHERE ticket_id = ? AND status IN ('pending','ready','error')) RETURNING *`,
      )
      .bind(ticket.client_id, ticket.id, text, ticket.id)
      .first();
  }
  if (!saved) return { ok: false, status: 409, error: 'The draft changed. Read the request again.' };
  await logEvent(db, 'agent_draft', {
    ticketId: ticket.id,
    clientId: ticket.client_id,
    data: { revision: saved.revision },
  });
  return {
    ok: true,
    status: 200,
    draft: {
      id: saved.id,
      revision: saved.revision,
      status: saved.status,
      source: saved.source,
      body: saved.body,
    },
  };
}

/** Add a private note to the conversation. Clients never see notes. */
export async function addAgentNote(db, ref, { body, idempotencyKey }) {
  const ticket = await getTicketByRef(db, ref);
  if (!ticket) return { ok: false, status: 404, error: 'Request not found.' };
  const text = String(body ?? '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!text || text.length > 12000)
    return { ok: false, status: 400, error: 'Send a note of 1 to 12,000 characters.' };
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key))
    return {
      ok: false,
      status: 400,
      error: 'Send an idempotency_key of 8 to 100 letters, numbers, underscores or hyphens.',
    };
  await db
    .prepare(
      `INSERT OR IGNORE INTO messages (client_id, ticket_id, author, body, visibility, idempotency_key)
    VALUES (?, ?, 'owner', ?, 'internal', ?)`,
    )
    .bind(ticket.client_id, ticket.id, `[Agent] ${text}`, `agent-note/${ticket.id}/${key}`)
    .run();
  return { ok: true, status: 200 };
}

const AGENT_KEY = /^[A-Za-z0-9_-]{8,100}$/;
// Sending always moves the request on, exactly as Send does on the desk.
const SEND_THEN = { waiting: 'waiting', resolve: 'done' };

/** Send the saved draft the owner approved in chat. Draft id, revision and text
    must match the ready draft, so only the reviewed wording reaches the client.
    The same idempotency_key never sends twice, even after the request closed.
    Once the reply is sent the answer is ok:true; state.ok says whether the
    request ended where you asked, so a failed state never invites a resend. */
export async function sendApprovedReply(env, origin, ref, input = {}, deliver = sendTicketEmail) {
  const then = String(input.then || 'waiting');
  if (!SEND_THEN[then])
    return {
      ok: false,
      status: 400,
      error:
        'Send then as waiting or resolve. Sending always moves the request on, as Send does on the desk.',
    };
  const key = String(input.idempotency_key || '').trim();
  if (!AGENT_KEY.test(key))
    return {
      ok: false,
      status: 400,
      error: 'Send an idempotency_key of 8 to 100 letters, numbers, underscores or hyphens.',
    };
  const ticket = await getTicketByRef(env.DB, ref);
  if (!ticket) return { ok: false, status: 404, error: 'Request not found.' };
  const repeat = await getMessageByIdempotencyKey(env.DB, composerMessageKey(ticket.id, 'send_reply', key));
  if (!repeat && Number(input.ticket_revision) !== ticket.revision) {
    return {
      ok: false,
      status: 409,
      error: 'This request changed. Nothing was sent. Read it again and confirm the draft with the owner.',
    };
  }
  const client = await getClientById(env.DB, ticket.client_id);
  const sent = await applyComposerAction(
    env,
    origin,
    {
      ticket,
      client,
      action: 'send_reply',
      body: input.body,
      idempotencyKey: key,
      draftId: Number(input.draft_id),
      draftRevision: Number(input.draft_revision),
      after: SEND_THEN[then],
      resolutionNote: then === 'resolve' ? input.note : '',
    },
    deliver,
  );
  if (!sent.ok) {
    return {
      ok: false,
      status: sent.status || 409,
      error: `${sent.error} Nothing was sent. Read the request again and confirm the draft with the owner.`,
    };
  }
  if (!sent.replayed) {
    await logEvent(env.DB, 'agent_send', {
      ticketId: ticket.id,
      clientId: ticket.client_id,
      data: { messageId: sent.messageId, then },
    });
  }
  // A first send moves the request in the same write as the message. A repeat
  // reports where the request is now and never moves it on an old instruction.
  const current = await getTicketByRef(env.DB, ticket.ref);
  const state =
    current.status === SEND_THEN[then]
      ? { ok: true, action: then, status: current.status }
      : {
          ok: false,
          action: then,
          status: current.status,
          error: `The reply was sent. The request is now ${current.status} and was not changed. Use the state call if it still needs to move.`,
        };
  return {
    ok: true,
    status: 200,
    messageId: sent.messageId,
    replayed: sent.replayed,
    delivery: sent.delivery,
    state,
  };
}

/** Resolve, dismiss, mark waiting or reopen, with the desk's own guards. */
export function changeStateForAgent(db, ref, input = {}) {
  return changeRequestState(db, ref, {
    action: String(input.action || ''),
    expectedRevision: Number(input.revision),
    reason: String(input.reason || ''),
    note: String(input.note || ''),
    duplicateRef: String(input.duplicate_ref || ''),
  });
}

/** The shape every agent POST shares: token check, JSON body, then the action. */
export async function agentJson(request, env, action) {
  const respond = (status, body) =>
    Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
  if (!isAgentRequest(request, env)) return respond(401, { ok: false, error: 'Unauthorized.' });
  let input;
  try {
    input = await request.json();
  } catch {
    return respond(400, { ok: false, error: 'Send JSON.' });
  }
  const result = await action(input && typeof input === 'object' ? input : {});
  return respond(result.status || (result.ok ? 200 : 409), result);
}
