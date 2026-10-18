/* Durable, idempotent request emails. Each notification has one row in
   email_deliveries, keyed by an idempotency key. Replaying a form submission
   can resume a failed delivery but can never send a second accepted email. */
import {
  logEvent, prepareEmailDelivery, claimEmailDelivery, markEmailAccepted, markEmailFailed,
} from './db.js';
import { sendEmail } from './email.js';

const FINISHED = ['accepted', 'delivered', 'bounced', 'complained'];

export async function sendTicketEmail(env, { ticket, payload, kind, recipientEmail, messageId = null, idempotencyKey = null }, send = sendEmail) {
  const key = idempotencyKey || `ticket/${ticket.id}/${messageId || 'ticket'}/${kind}`;
  if (!recipientEmail) {
    return { ok: false, detail: 'No recipient address is configured.' };
  }
  const delivery = await prepareEmailDelivery(env.DB, {
    clientId: ticket.client_id, ticketId: ticket.id, messageId, kind,
    recipientEmail, subject: payload.subject, payload, idempotencyKey: key,
  });
  if (FINISHED.includes(delivery.status)) {
    return { ok: ['accepted', 'delivered'].includes(delivery.status), status: delivery.status, replayed: true, deliveryId: delivery.id };
  }
  const claim = await claimEmailDelivery(env.DB, delivery.id);
  if (!claim.ok) return { ok: false, pending: true, detail: 'This email is already being sent.', deliveryId: delivery.id };

  // Always send the frozen copy, so a retry matches the original exactly.
  const frozen = JSON.parse(claim.row.payload_json);
  const result = await send(env, { ...frozen, idempotencyKey: claim.row.idempotency_key });
  if (result.ok) {
    await markEmailAccepted(env.DB, delivery.id, result.providerMessageId);
    await logEvent(env.DB, 'email_sent', {
      ticketId: ticket.id, clientId: ticket.client_id,
      data: { kind, messageId, deliveryId: delivery.id, recipient: recipientEmail, providerMessageId: result.providerMessageId },
    });
  } else {
    await markEmailFailed(env.DB, delivery.id, result.detail);
    await logEvent(env.DB, 'email_failed', {
      ticketId: ticket.id, clientId: ticket.client_id,
      data: { kind, messageId, deliveryId: delivery.id, recipient: recipientEmail, status: result.status || null, detail: String(result.detail || '').slice(0, 500) },
    });
  }
  return { ...result, deliveryId: delivery.id };
}
