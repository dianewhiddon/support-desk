/* POST: save the reply draft, send it, or save a private note. Answers JSON. */
import { env } from 'cloudflare:workers';
import { getTicketByRef, getClientById, getMessageByIdempotencyKey, isClosed } from '../../../../../lib/db.js';
import { saveReplyDraft, applyComposerAction, composerMessageKey } from '../../../../../lib/workflow.js';
import { listReplyFiles } from '../../../../../lib/reply-files.js';

const respond = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function POST(context) {
  const ticket = await getTicketByRef(env.DB, context.params.ref);
  if (!ticket) return respond(404, { ok: false, error: 'Request not found.' });
  let form;
  try { form = await context.request.formData(); } catch { return respond(400, { ok: false, error: 'The form could not be read.' }); }
  const action = String(form.get('action') || '');
  if (!['save_draft', 'send_reply', 'save_note'].includes(action)) return respond(400, { ok: false, error: 'Reload this page to use the current editor.' });
  const idempotencyKey = String(form.get('idempotency_key') || '').trim();
  const replay = action !== 'save_draft' && idempotencyKey
    && await getMessageByIdempotencyKey(env.DB, composerMessageKey(ticket.id, action, idempotencyKey));
  if (!replay && isClosed(ticket)) return respond(409, { ok: false, error: 'Reopen the request before replying.' });
  if (!replay && Number(form.get('ticket_revision')) !== ticket.revision) {
    return respond(409, { ok: false, error: 'This request changed. Your text is still here. Reload before continuing.' });
  }

  let saved = null;
  if (action !== 'save_note' && !replay) {
    saved = await saveReplyDraft(env.DB, ticket, {
      body: form.get('body'),
      draftId: form.get('draft_id') || null,
      expectedRevision: Number(form.get('draft_revision') || 0),
      ticketRevision: Number(form.get('ticket_revision')),
      forFiles: action === 'save_draft' && form.get('for_files') === '1',
    });
    if (!saved.ok) return respond(saved.status, saved);
    if (action === 'save_draft') return respond(200, { ...saved, attachments: await listReplyFiles(env.DB, ticket.id, saved.draft.id) });
  }

  const client = await getClientById(env.DB, ticket.client_id);
  const result = await applyComposerAction(env, context.url.origin, {
    ticket, client, action, body: form.get('body'), idempotencyKey,
    draftId: saved?.draft?.id ?? null, draftRevision: saved?.draft?.revision ?? null,
    after: String(form.get('after') || 'waiting'),
  });
  if (!result.ok) return respond(result.status || 409, { ...result, draft: saved?.draft });
  const outcome = result.delivery?.pending ? 'email_pending' : result.delivery && !result.delivery.ok ? 'email_failed' : action;
  return respond(200, { ...result, redirect: `/admin/tickets/${ticket.ref}?result=${outcome}` });
}
