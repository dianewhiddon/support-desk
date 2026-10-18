/* POST: retry a notification from its frozen copy. It never creates a new message. */
import { env } from 'cloudflare:workers';
import { getTicketByRef, getEmailDelivery } from '../../../../../lib/db.js';
import { sendTicketEmail } from '../../../../../lib/ticket-email.js';

export async function POST(context) {
  const ticket = await getTicketByRef(env.DB, context.params.ref);
  if (!ticket) return context.redirect('/admin', 303);
  let deliveryId = 0;
  try {
    deliveryId = Number((await context.request.formData()).get('delivery_id'));
  } catch {
    /* invalid below */
  }
  const delivery =
    Number.isInteger(deliveryId) && deliveryId > 0 ? await getEmailDelivery(env.DB, deliveryId) : null;
  const back = (result) =>
    context.redirect(`/admin/tickets/${ticket.ref}?result=${result}#notifications`, 303);
  if (
    !delivery ||
    delivery.ticket_id !== ticket.id ||
    !['pending', 'failed', 'sending'].includes(delivery.status)
  )
    return back('email_unchanged');
  const result = await sendTicketEmail(env, {
    ticket,
    messageId: delivery.message_id,
    kind: delivery.kind,
    recipientEmail: delivery.recipient_email,
    payload: JSON.parse(delivery.payload_json),
    idempotencyKey: delivery.idempotency_key,
  });
  return back(result.ok ? 'email_retried' : result.pending ? 'email_pending' : 'email_retry_failed');
}
