/* Durable, idempotent request emails. Each notification has one row in
   email_deliveries, keyed by an idempotency key. Replaying a form submission
   can resume an unconfirmed delivery within the provider idempotency window. */
import {
  logEvent,
  prepareEmailDelivery,
  claimEmailDelivery,
  markEmailAccepted,
  markEmailFailed,
} from './db.js';
import { sendEmail } from './email.js';

const FINISHED = ['accepted', 'delivered', 'delayed', 'bounced', 'complained'];

export async function sendTicketEmail(
  env,
  { ticket, payload, kind, recipientEmail, messageId = null, idempotencyKey = null },
  send = sendEmail,
) {
  const key = idempotencyKey || `ticket/${ticket.id}/${messageId || 'ticket'}/${kind}`;
  if (!recipientEmail) {
    return { ok: false, detail: 'No recipient address is configured.' };
  }
  const delivery = await prepareEmailDelivery(env.DB, {
    clientId: ticket.client_id,
    ticketId: ticket.id,
    messageId,
    kind,
    recipientEmail,
    subject: payload.subject,
    payload,
    idempotencyKey: key,
  });
  if (FINISHED.includes(delivery.status) || delivery.provider_message_id) {
    return {
      ok: ['accepted', 'delivered'].includes(delivery.status),
      status: delivery.status,
      replayed: true,
      deliveryId: delivery.id,
    };
  }
  // Resend retains idempotency keys for 24 hours. An old unconfirmed attempt
  // requires provider reconciliation, never a blind retry that might duplicate it.
  if (
    delivery.attempt_count > 0 &&
    Date.now() - Date.parse(`${delivery.created_at.replace(' ', 'T')}Z`) >= 23 * 3600_000
  ) {
    return {
      ok: false,
      detail:
        'Check this delivery in Resend before sending another notification; the safe retry window has expired.',
      deliveryId: delivery.id,
    };
  }
  const claim = await claimEmailDelivery(env.DB, delivery.id);
  if (!claim.ok)
    return { ok: false, pending: true, detail: 'This email is already being sent.', deliveryId: delivery.id };

  // Always send the frozen copy, so a retry matches the original exactly.
  const frozen = JSON.parse(claim.row.payload_json);
  let result;
  try {
    result = await send(env, { ...frozen, idempotencyKey: claim.row.idempotency_key });
  } catch {
    result = { ok: false, detail: 'The email service could not confirm delivery.' };
  }
  if (result.ok) {
    await markEmailAccepted(env.DB, delivery.id, result.providerMessageId);
    await logEvent(env.DB, 'email_sent', {
      ticketId: ticket.id,
      clientId: ticket.client_id,
      data: {
        kind,
        messageId,
        deliveryId: delivery.id,
        recipient: recipientEmail,
        providerMessageId: result.providerMessageId,
      },
    });
  } else {
    await markEmailFailed(env.DB, delivery.id, result.detail);
    await logEvent(env.DB, 'email_failed', {
      ticketId: ticket.id,
      clientId: ticket.client_id,
      data: {
        kind,
        messageId,
        deliveryId: delivery.id,
        recipient: recipientEmail,
        status: result.status || null,
        detail: String(result.detail || '').slice(0, 500),
      },
    });
  }
  return { ...result, deliveryId: delivery.id };
}
