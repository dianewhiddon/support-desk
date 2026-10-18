/* Email through Resend's HTTP API (plain fetch, no SDK).

   Clients get short system notifications that send them back to the desk,
   where the conversation lives. Nothing private travels in an email body.
   Notes to the owner are plain text with the request content, so the owner
   can triage from a phone.

   Without RESEND_API_KEY (local development) nothing is sent; the payload is
   logged to the terminal instead, including sign-in links. */
import { appConfig } from './config.js';
import { renderNotificationEmail } from './email-layout.js';

export async function sendEmail(env, payload) {
  const config = appConfig(env);
  const { idempotencyKey, ...message } = payload;
  if (!env.RESEND_API_KEY) {
    console.log('[email not sent: RESEND_API_KEY is not set]', JSON.stringify({ to: message.to, subject: message.subject, text: message.text }));
    return { ok: false, status: 503, detail: 'Email is not configured. Set RESEND_API_KEY.' };
  }
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: config.emailFrom, ...message }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, status: 503, detail: 'The email service could not be reached.' };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Resend error', response.status, detail);
    return { ok: false, status: response.status, detail: detail.slice(0, 500) || 'The email service rejected the message.' };
  }
  const data = await response.json().catch(() => null);
  if (!data?.id) return { ok: false, status: 502, detail: 'The email service did not return a delivery receipt.' };
  return { ok: true, providerMessageId: data.id };
}

const firstName = (person) => String(person?.name || '').trim().split(/\s+/)[0] || 'there';
const who = (client) => client.name || client.company || client.email;

function toClient(env, { client, subject, heading, body, actionLabel, actionUrl, files = [] }) {
  const config = appConfig(env);
  const { html, text } = renderNotificationEmail({
    businessName: config.businessName, firstName: firstName(client), heading, body, actionLabel, actionUrl, files,
  });
  return { to: client.email, ...(config.noReply ? { reply_to: config.noReply } : {}), subject, html, text };
}

function toOwner(env, { subject, lines }) {
  const config = appConfig(env);
  return {
    to: config.ownerEmail,
    ...(config.noReply ? { reply_to: config.noReply } : {}),
    subject,
    text: lines.filter((line) => line !== null && line !== undefined).join('\n'),
  };
}

export function magicLinkEmail(env, { email, name, admin, url }) {
  const config = appConfig(env);
  return toClient(env, {
    client: { email, name },
    subject: `Your sign-in link for ${config.businessName}`,
    heading: admin ? 'Sign in to your support desk.' : 'Sign in to see your requests.',
    body: 'This secure link works once and expires in 30 minutes. If you did not ask for it, you can ignore this email.',
    actionLabel: 'Sign in',
    actionUrl: url,
  });
}

const TYPE_LABEL = { change: 'change request', question: 'question', urgent: 'URGENT request' };

/** The desk titles a request with its opening words. When the title is that
    excerpt, the owner's notice leaves it out and shows the whole message once. */
export function titleRepeatsBody(title, body) {
  const clean = (value) => String(value || '').replace(/^(Question|Urgent):\s*/, '').replace(/…$/, '').replace(/\s+/g, ' ').trim();
  const head = clean(title);
  return !head || clean(body).startsWith(head);
}

export function newTicketEmailToOwner(env, { ticket, client, site, adminUrl, links = [], attachments = [] }) {
  return toOwner(env, {
    subject: `${ticket.type === 'urgent' ? 'URGENT' : 'New request'} ${ticket.ref} from ${who(client)}`,
    lines: [
      `${client.name || client.email}${client.company ? ` (${client.company})` : ''} sent a ${TYPE_LABEL[ticket.type] || 'request'}.`,
      '',
      `Ref: ${ticket.ref}`,
      site ? `Site: ${site.label || site.url}` : null,
      ticket.page ? `Page: ${ticket.page}` : null,
      titleRepeatsBody(ticket.title, ticket.body) ? null : `Title: ${ticket.title}`,
      '',
      ticket.body,
      ...(links.length ? ['', 'Links:', ...links] : []),
      ...(attachments.length ? ['', 'Files on the desk:', ...attachments.map((file) => `- ${file.filename}`)] : []),
      '',
      `Open and reply: ${adminUrl}`,
    ],
  });
}

export function clientReplyEmailToOwner(env, { ticket, client, message, adminUrl, links = [], attachments = [] }) {
  return toOwner(env, {
    subject: `Reply to ${ticket.ref} from ${who(client)}`,
    lines: [
      `${client.name || client.email} replied to ${ticket.ref}.`,
      '',
      message,
      ...(links.length ? ['', 'Links:', ...links] : []),
      ...(attachments.length ? ['', 'Files on the desk:', ...attachments.map((file) => `- ${file.filename}`)] : []),
      '',
      `Open and reply: ${adminUrl}`,
    ],
  });
}

export function feedbackFlagEmailToOwner(env, { ticket, client, note, adminUrl }) {
  return toOwner(env, {
    subject: `${ticket.ref} reopened: ${who(client)} says something is off`,
    lines: [
      `${client.name || client.email} says ${ticket.ref} did not land right.`,
      '',
      note || '(No note.)',
      '',
      `The request is open again: ${adminUrl}`,
    ],
  });
}

/** The receipt for a new request. The request page shows the same words after
    the client submits; only the page can say "here". */
export function requestReceivedCopy(type, ownerName, { onPage = false } = {}) {
  if (type === 'urgent') {
    return { heading: 'We received your urgent request.', body: `It's at the top of ${ownerName}'s queue. We'll email you as soon as we have an update.` };
  }
  if (type === 'question') {
    return { heading: 'We received your question.', body: `${ownerName} will answer it ${onPage ? 'here' : 'on the desk'}, and we'll email you when the answer is ready.` };
  }
  return { heading: 'We received your request.', body: `${ownerName} is on it. We'll email you when it's done, or sooner if we have an update.` };
}

export function requestReceivedEmailToClient(env, { ticket, client, url }) {
  const copy = requestReceivedCopy(ticket.type, appConfig(env).ownerName);
  return toClient(env, {
    client,
    subject: `${copy.heading.replace(/\.$/, '')} (${ticket.ref})`,
    heading: copy.heading,
    body: copy.body,
    actionLabel: 'View your request',
    actionUrl: url,
  });
}

/** The reply itself stays on the desk; the email only says there is one. */
export function replyEmailToClient(env, { ticket, client, url, attachments = [], waiting = false }) {
  const config = appConfig(env);
  const action = new URL(url);
  action.searchParams.set('reply', '1');
  action.hash = 'reply';
  return toClient(env, {
    client,
    subject: waiting ? `${config.ownerName} needs your reply` : `${config.ownerName} replied to your request`,
    heading: waiting ? `${config.ownerName} needs your reply.` : `${config.ownerName} replied to your request.`,
    body: `Open ${ticket.ref} to read the message and reply there.`,
    actionLabel: 'Read and reply',
    actionUrl: action.toString(),
    files: attachments.map((file) => ({ name: file.filename || 'File', url: new URL(`/files/${file.id}`, url).toString() })),
  });
}
