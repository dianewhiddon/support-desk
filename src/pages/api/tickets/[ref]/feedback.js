/* POST /api/tickets/<ref>/feedback: the one-tap check after a request is done. */
import { env } from 'cloudflare:workers';
import { getTicketByRef } from '../../../../lib/db.js';
import { recordFeedback, afterResponse } from '../../../../lib/requests.js';

export async function POST(context) {
  const client = context.locals.client;
  const ticket = await getTicketByRef(env.DB, context.params.ref);
  if (!ticket || ticket.client_id !== client.id) return context.redirect('/dashboard', 303);
  if (ticket.status !== 'done') return context.redirect(`/tickets/${ticket.ref}`, 303);
  let form = null;
  try { form = await context.request.formData(); } catch { /* treated as a thumbs-up below */ }
  const ok = form?.get('ok') !== '0';
  const result = await recordFeedback(env, { client, ticket, ok, note: form?.get('note'), origin: context.url.origin });
  await afterResponse(context, result.notify);
  return context.redirect(`/tickets/${ticket.ref}?thanks=${ok ? '1' : '0'}`, 303);
}
