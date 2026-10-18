/* Resend delivery receipts. The raw body is verified with Svix before any
   state changes, and the svix-id makes provider retries idempotent. */
import { env } from 'cloudflare:workers';
import { Webhook } from 'svix';
import { recordEmailProviderEvent } from '../../../lib/db.js';

const STATUS = {
  'email.sent': 'accepted',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

const json = (status, body) => Response.json(body, { status });

export async function POST(context) {
  if (!env.RESEND_WEBHOOK_SECRET) return json(503, { error: 'Webhook is not configured.' });
  const raw = await context.request.text();
  const headers = {
    'svix-id': context.request.headers.get('svix-id'),
    'svix-timestamp': context.request.headers.get('svix-timestamp'),
    'svix-signature': context.request.headers.get('svix-signature'),
  };
  if (!headers['svix-id'] || !headers['svix-timestamp'] || !headers['svix-signature']) return json(400, { error: 'Missing signature headers.' });
  let event;
  try {
    event = new Webhook(env.RESEND_WEBHOOK_SECRET).verify(raw, headers);
  } catch {
    return json(400, { error: 'Invalid webhook signature.' });
  }
  const status = STATUS[event?.type];
  if (!status) return json(200, { ok: true, ignored: true });
  const data = event.data || {};
  const detail = data.bounce?.message || data.failed?.message || data.reason || null;
  await recordEmailProviderEvent(env.DB, {
    svixId: headers['svix-id'],
    eventType: event.type,
    emailId: data.email_id,
    eventAt: event.created_at,
    status,
    detail: detail ? String(detail).slice(0, 500) : null,
  });
  return json(200, { ok: true });
}
