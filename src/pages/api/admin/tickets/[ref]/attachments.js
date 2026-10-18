/* POST adds a file to the reply draft; DELETE removes one. Answers JSON. */
import { env } from 'cloudflare:workers';
import { getTicketByRef } from '../../../../../lib/db.js';
import { addReplyFile, removeReplyFile } from '../../../../../lib/reply-files.js';

const respond = (result) => Response.json(result, { status: result.status || 200, headers: { 'cache-control': 'private, no-store' } });

async function handle(context) {
  const ticket = await getTicketByRef(env.DB, context.params.ref);
  if (!ticket) return respond({ ok: false, status: 404, error: 'Request not found.' });
  let form;
  try { form = await context.request.formData(); } catch { return respond({ ok: false, status: 400, error: 'The upload could not be read.' }); }
  const input = {
    draftId: Number(form.get('draft_id')),
    draftRevision: Number(form.get('draft_revision')),
    ticketRevision: Number(form.get('ticket_revision')),
    idempotencyKey: form.get('idempotency_key'),
  };
  try {
    return respond(context.request.method === 'DELETE'
      ? await removeReplyFile(env, ticket, input, form.get('attachment_id'))
      : await addReplyFile(env, ticket, input, form.get('file')));
  } catch {
    return respond({ ok: false, status: 503, error: 'File storage could not be confirmed. Retry the upload or reload the draft.' });
  }
}

export const POST = handle;
export const DELETE = handle;
