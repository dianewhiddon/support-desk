import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnv, seedClient, recordingSender, pngFile } from './helpers.js';
import { createRequest, addClientReply, recordFeedback, defaultTitle } from '../src/lib/requests.js';
import { sendTicketEmail } from '../src/lib/ticket-email.js';
import { getTicketByRef } from '../src/lib/db.js';
import { titleRepeatsBody, requestReceivedCopy, requestReceivedEmailToClient, newTicketEmailToOwner } from '../src/lib/email.js';

const origin = 'https://desk.test';
const viaRecorder = (recorder) => (env, args) => sendTicketEmail(env, args, recorder.send);

test('a new request stores the ticket and its files, then emails the owner and the client', async (t) => {
  const { env, sqlite } = createEnv(t);
  const client = seedClient(sqlite);
  const mail = recordingSender();
  const result = await createRequest(env, {
    client, origin, files: [pngFile()],
    input: { type: 'change', submissionKey: 'key-1', body: 'Change the headline on Home.', page: 'Home', links: 'https://docs.example.com/a\nnot a link' },
  }, viaRecorder(mail));
  assert.equal(result.ok, true);
  assert.match(result.ref, /^SUP-\d{4}-0001$/);
  const ticket = await getTicketByRef(env.DB, result.ref);
  assert.equal(ticket.status, 'new');
  assert.equal(ticket.site_id, 1, 'a single site is chosen automatically');
  assert.deepEqual(JSON.parse(ticket.links), ['https://docs.example.com/a']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ticket_attachments').get().n, 1);
  assert.equal(env.UPLOADS.objects.size, 1);
  await result.notify();
  assert.equal(mail.sent.length, 2);
  const owner = mail.sent.find((email) => email.to === 'kyle@studio.test');
  assert.match(owner.text, /Change the headline on Home\./);
  assert.match(owner.text, /https:\/\/desk\.test\/admin\/tickets\/SUP-/);
  assert.doesNotMatch(owner.text, /Title:/, 'the title is the opening words, so the message shows once');
  assert.equal(owner.text.split('Change the headline').length, 2);
  const receipt = mail.sent.find((email) => email.to === 'sarah@example.com');
  assert.equal(receipt.subject, `We received your request (${result.ref})`);
  assert.match(receipt.text, /Kyle is on it\. We'll email you when it's done, or sooner if we have an update\./);
  assert.match(receipt.text, new RegExp(`View your request: https://desk\\.test/tickets/${result.ref}`));
  assert.equal(receipt.reply_to, 'no-reply@studio.test');
  await result.notify();
  assert.equal(mail.sent.length, 2, 'a replayed notify never sends either email twice');
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM email_deliveries WHERE kind = 'request_received_client'").get().n, 1);
});

test('the receipt matches the request type, and the page says the same words', () => {
  const env = { OWNER_NAME: 'Kyle', BUSINESS_NAME: 'Skynet Web Studio' };
  const client = { email: 'sarah@example.com', name: 'Sarah Connor' };
  const url = 'https://desk.test/tickets/SUP-2026-0001';
  const urgent = requestReceivedEmailToClient(env, { client, url, ticket: { ref: 'SUP-2026-0001', type: 'urgent' } });
  assert.equal(urgent.subject, 'We received your urgent request (SUP-2026-0001)');
  assert.match(urgent.text, /It's at the top of Kyle's queue\. We'll email you as soon as we have an update\./);
  const question = requestReceivedEmailToClient(env, { client, url, ticket: { ref: 'SUP-2026-0001', type: 'question' } });
  assert.match(question.text, /Kyle will answer it on the desk/);
  assert.match(requestReceivedCopy('question', 'Kyle', { onPage: true }).body, /^Kyle will answer it here,/);
  for (const type of ['change', 'urgent', 'question']) {
    const email = requestReceivedEmailToClient(env, { client, url, ticket: { ref: 'SUP-2026-0001', type } });
    const copy = requestReceivedCopy(type, 'Kyle', { onPage: true });
    assert.match(email.text, new RegExp(copy.heading.replace(/\./g, '\\.')));
    assert.doesNotMatch(email.text + email.html, /—|\bhere\b|within \d|business days?|hours?\b/i);
  }
  const page = readFileSync('src/pages/tickets/[ref].astro', 'utf8');
  assert.match(page, /requestReceivedCopy\(ticket\.type, config\.ownerName, \{ onPage: true \}\)/);
  assert.match(page, /visible\.length === 0 && !created/, 'the empty-thread line hides while the receipt shows');
});

test('owner notices show the message once and name the request by reference', () => {
  const env = { OWNER_NAME: 'Kyle', OWNER_EMAIL: 'kyle@studio.test' };
  const body = 'Please update every heading on the services page so they match the new brand guide we approved';
  assert.equal(titleRepeatsBody(defaultTitle('change', body), body), true);
  assert.equal(titleRepeatsBody(defaultTitle('question', 'Can we add a blog?'), 'Can we add a blog?'), true);
  assert.equal(titleRepeatsBody(defaultTitle('urgent', 'Site is down'), 'Site is down'), true);
  const custom = newTicketEmailToOwner(env, {
    client: { name: 'Sarah Connor', email: 'sarah@example.com' }, site: null, adminUrl: 'https://desk.test/admin/tickets/SUP-1',
    ticket: { ref: 'SUP-1', type: 'change', title: 'Services page headings', body },
  });
  assert.match(custom.text, /Title: Services page headings/, 'a title that differs from the excerpt stays');
});

test('a client reply and a feedback flag name the request by reference, not its excerpt', async (t) => {
  const { env, sqlite } = createEnv(t);
  const client = seedClient(sqlite);
  const { ref } = await createRequest(env, { client, origin, files: [], input: { type: 'change', submissionKey: 'k', body: 'Please fix the footer address on every page' } });
  const mail = recordingSender();
  const reply = await addClientReply(env, { client, ticket: await getTicketByRef(env.DB, ref), input: { idempotencyKey: 'r1', body: 'The new address is 19828 Main St.' }, files: [], origin }, viaRecorder(mail));
  await reply.notify();
  assert.equal(mail.sent.length, 1, 'a follow-up reply sends no receipt');
  assert.equal(mail.sent[0].to, 'kyle@studio.test');
  assert.match(mail.sent[0].text, new RegExp(`^Sarah Connor replied to ${ref}\\.\n\nThe new address is`));
  assert.doesNotMatch(mail.sent[0].text, /fix the footer/);
  sqlite.prepare("UPDATE tickets SET status = 'done'").run();
  const flag = await recordFeedback(env, { client, ticket: await getTicketByRef(env.DB, ref), ok: false, note: 'Still the old one.', origin }, viaRecorder(mail));
  await flag.notify();
  assert.match(mail.sent[1].text, new RegExp(`^Sarah Connor says ${ref} did not land right\\.`));
});

test('nothing drafts a reply when a request or a client reply arrives', async (t) => {
  const { env, sqlite } = createEnv(t, { ANTHROPIC_API_KEY: 'test-key' });
  const client = seedClient(sqlite);
  const mail = recordingSender();
  const created = await createRequest(env, { client, origin, files: [], input: { type: 'change', submissionKey: 'k', body: 'Swap the logo' } }, viaRecorder(mail));
  await created.notify();
  const reply = await addClientReply(env, { client, ticket: await getTicketByRef(env.DB, created.ref), input: { idempotencyKey: 'r', body: 'Here is the file.' }, files: [], origin }, viaRecorder(mail));
  await reply.notify();
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM reply_drafts').get().n, 0);
  for (const route of ['src/pages/api/tickets.js', 'src/pages/api/tickets/[ref]/reply.js']) {
    assert.doesNotMatch(readFileSync(route, 'utf8'), /draftReply/, `${route} never drafts on arrival`);
  }
  assert.match(readFileSync('src/pages/api/admin/tickets/[ref]/ai-draft.js', 'utf8'), /draftReplyInVoice/, 'Draft with AI stays');
});

test('a resubmitted form returns the same request instead of a duplicate', async (t) => {
  const { env, sqlite } = createEnv(t);
  const client = seedClient(sqlite);
  const input = { type: 'question', submissionKey: 'same-key', body: 'When can we launch?' };
  const first = await createRequest(env, { client, origin, files: [], input });
  const second = await createRequest(env, { client, origin, files: [], input });
  assert.equal(second.ref, first.ref);
  assert.equal(second.replayed, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tickets').get().n, 1);
});

test('the emergency box makes a change urgent, and invalid files stop the request', async (t) => {
  const { env, sqlite } = createEnv(t);
  const client = seedClient(sqlite);
  const urgent = await createRequest(env, { client, origin, files: [], input: { type: 'change', emergency: true, submissionKey: 'u', body: 'Site is down' } });
  assert.equal((await getTicketByRef(env.DB, urgent.ref)).type, 'urgent');
  const fake = new File([new TextEncoder().encode('not really a png')], 'x.png', { type: 'image/png' });
  const rejected = await createRequest(env, { client, origin, files: [fake], input: { type: 'change', submissionKey: 'f', body: 'See file' } });
  assert.deepEqual(rejected, { ok: false, error: 'attachments' });
  const empty = await createRequest(env, { client, origin, files: [], input: { type: 'change', submissionKey: 'e', body: '   ' } });
  assert.deepEqual(empty, { ok: false, error: 'empty' });
});

test('a client reply reopens the conversation for the owner and is idempotent', async (t) => {
  const { env, sqlite } = createEnv(t);
  const client = seedClient(sqlite);
  const { ref } = await createRequest(env, { client, origin, files: [], input: { type: 'change', submissionKey: 'k', body: 'Fix the footer' } });
  sqlite.prepare("UPDATE tickets SET status = 'waiting'").run();
  const ticket = await getTicketByRef(env.DB, ref);
  const mail = recordingSender();
  const input = { idempotencyKey: 'reply-1', body: 'Here is the new address.' };
  const first = await addClientReply(env, { client, ticket, input, files: [], origin }, viaRecorder(mail));
  await first.notify();
  const again = await addClientReply(env, { client, ticket, input, files: [], origin }, viaRecorder(mail));
  assert.equal(again.replayed, true);
  assert.equal((await getTicketByRef(env.DB, ref)).status, 'open');
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE author = 'client'").get().n, 1);
  assert.equal(mail.sent.length, 1);
});

test('"something is off" reopens a finished request with the note; "all good" changes nothing', async (t) => {
  const { env, sqlite } = createEnv(t);
  const client = seedClient(sqlite);
  const { ref } = await createRequest(env, { client, origin, files: [], input: { type: 'change', submissionKey: 'k', body: 'Swap the logo' } });
  sqlite.prepare("UPDATE tickets SET status = 'done', resolved_at = datetime('now')").run();
  await recordFeedback(env, { client, ticket: await getTicketByRef(env.DB, ref), ok: true, origin });
  assert.equal((await getTicketByRef(env.DB, ref)).status, 'done');
  const mail = recordingSender();
  const flagged = await recordFeedback(env, { client, ticket: await getTicketByRef(env.DB, ref), ok: false, note: 'The old logo still shows on mobile.', origin }, viaRecorder(mail));
  await flagged.notify();
  const reopened = await getTicketByRef(env.DB, ref);
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.resolved_at, null);
  assert.equal(sqlite.prepare('SELECT body FROM messages').get().body, 'The old logo still shows on mobile.');
  assert.match(mail.sent[0].subject, /reopened/);
});

test('titles are short and keep whole words', () => {
  assert.equal(defaultTitle('question', 'Can we add a blog?'), 'Question: Can we add a blog?');
  const long = defaultTitle('change', 'Please update every heading on the services page so they match the new brand guide we approved');
  assert.ok(long.length <= 63);
  assert.ok(long.endsWith('…'));
});
