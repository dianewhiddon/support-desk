/* POST /api/tickets/<ref>/reply: a client adds to the conversation. */
import { env } from 'cloudflare:workers';
import { getTicketByRef } from '../../../../lib/db.js';
import { addClientReply, afterResponse } from '../../../../lib/requests.js';
import { formFiles } from '../../../../lib/uploads.js';

export async function POST(context) {
  const client = context.locals.client;
  const ticket = await getTicketByRef(env.DB, context.params.ref);
  if (!ticket || ticket.client_id !== client.id) return context.redirect('/dashboard', 303);
  const back = (state) => context.redirect(`/tickets/${ticket.ref}?reply=${state}#reply`, 303);
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return back('error');
  }
  const result = await addClientReply(env, {
    client,
    ticket,
    files: formFiles(form),
    origin: context.url.origin,
    input: { idempotencyKey: form.get('idempotency_key'), body: form.get('body'), links: form.get('links') },
  });
  if (!result.ok) return back('error');
  if (!result.replayed) {
    // No reply is drafted here: the reply is written after the work is done.
    await afterResponse(context, result.notify);
  }
  return back('sent');
}
