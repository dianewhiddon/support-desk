import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, seedClient, pngFile, officeFile } from './helpers.js';
import { safeNextPath } from '../src/lib/paths.js';
import { canClientRead, attachmentHeaders, attachmentResponse } from '../src/lib/attachments.js';
import { validateTicketFile, validateTicketFiles } from '../src/lib/uploads.js';
import { validateReplyFile } from '../src/lib/reply-files.js';
import { messageLinks, safeHref } from '../src/lib/render.js';
import { recordEmailProviderEvent } from '../src/lib/db.js';
import { isAdminEmail } from '../src/lib/config.js';

test('sign-in redirects stay on this site', () => {
  assert.equal(safeNextPath('/tickets/SUP-2026-0001?reply=1#reply'), '/tickets/SUP-2026-0001?reply=1#reply');
  for (const bad of ['https://evil.test/', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '']) {
    assert.equal(safeNextPath(bad), '');
  }
});

test('admin access comes only from ADMIN_EMAILS', () => {
  const env = { ADMIN_EMAILS: 'Kyle@Studio.test, partner@studio.test' };
  assert.equal(isAdminEmail(env, 'kyle@studio.test'), true);
  assert.equal(isAdminEmail(env, 'sarah@example.com'), false);
  assert.equal(isAdminEmail({ ADMIN_EMAILS: '' }, ''), false);
});

test('clients read only their own conversation files', () => {
  const own = { owner_client_id: 1, message_id: null, role: null };
  assert.equal(canClientRead(own, 1), true);
  assert.equal(canClientRead(own, 2), false);
  assert.equal(canClientRead({ ...own, role: 'reply_draft' }, 1), false);
  assert.equal(canClientRead({ ...own, message_id: 9, message_visibility: 'internal' }, 1), false);
  assert.equal(
    canClientRead({ ...own, message_id: 9, message_visibility: 'client', role: 'reply_sent' }, 1),
    true,
  );
});

test('downloads are sandboxed and only images and audio display inline', () => {
  const pdf = attachmentHeaders({ filename: 'résumé "final".pdf', content_type: 'application/pdf' });
  assert.match(pdf['content-disposition'], /^attachment; filename="r_sum_ final.pdf"; filename\*=UTF-8''/);
  assert.equal(pdf['content-security-policy'], "sandbox; default-src 'none'");
  assert.match(
    attachmentHeaders({ filename: 'a.png', content_type: 'image/png' })['content-disposition'],
    /^inline/,
  );
});

test('another client cannot download a file by guessing its id', async (t) => {
  const { env, sqlite } = createEnv(t);
  seedClient(sqlite);
  seedClient(sqlite, { email: 'miles@example.com', name: 'Miles Dyson' });
  sqlite.exec(`INSERT INTO tickets (ref, client_id, title, body) VALUES ('SUP-1', 1, 'T', 'B');
    INSERT INTO ticket_attachments (ticket_id, r2_key, filename, content_type) VALUES (1, 'k', 'a.png', 'image/png');`);
  await env.UPLOADS.put('k', 'bytes');
  assert.equal((await attachmentResponse(env, 1, { clientId: 2 })).status, 403);
  assert.equal((await attachmentResponse(env, 1, { clientId: 1 })).status, 200);
  assert.equal((await attachmentResponse(env, 1, {})).status, 403);
});

test('uploads are checked by their contents, not their names', async () => {
  assert.equal((await validateTicketFile(pngFile())).ok, true);
  const disguised = new File([new TextEncoder().encode('<script>alert(1)</script>')], 'photo.png', {
    type: 'image/png',
  });
  assert.deepEqual(await validateTicketFile(disguised), { ok: false, reason: 'signature' });
  const html = new File([new TextEncoder().encode('<html>')], 'page.html', { type: 'text/html' });
  assert.equal((await validateTicketFile(html)).ok, false);
  const text = new File([new TextEncoder().encode('Plain notes')], 'notes.txt', { type: 'text/plain' });
  assert.equal((await validateTicketFile(text)).ok, true);
  assert.equal((await validateTicketFiles(Array.from({ length: 7 }, () => pngFile()))).reason, 'too_many');
});

test('reply files reject Office documents that carry macros', async () => {
  const docx = officeFile;
  assert.equal((await validateReplyFile(docx(['[Content_Types].xml', 'word/document.xml']))).ok, true);
  assert.equal(
    (await validateReplyFile(docx(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']))).ok,
    false,
  );
});

test('message links render only http and https', () => {
  const parts = messageLinks(
    'See https://example.com/page. Or [the doc](https://docs.example.com) and javascript:alert(1)',
  );
  assert.deepEqual(
    parts.filter((part) => part.href).map((part) => part.href),
    ['https://example.com/page', 'https://docs.example.com'],
  );
  assert.equal(safeHref('javascript:alert(1)'), '#');
});

test('delivery webhooks are applied once and never move status backwards', async (t) => {
  const { env, sqlite } = createEnv(t);
  seedClient(sqlite);
  sqlite.exec(`INSERT INTO tickets (ref, client_id, title, body) VALUES ('SUP-1', 1, 'T', 'B');
    INSERT INTO email_deliveries (client_id, ticket_id, kind, recipient_email, payload_json, status, idempotency_key, provider_message_id)
    VALUES (1, 1, 'reply', 'sarah@example.com', '{}', 'accepted', 'k', 'em_1');`);
  assert.equal(
    await recordEmailProviderEvent(env.DB, { svixId: 'a', emailId: 'em_1', status: 'delivered' }),
    true,
  );
  assert.equal(
    await recordEmailProviderEvent(env.DB, { svixId: 'a', emailId: 'em_1', status: 'delivered' }),
    false,
  );
  await recordEmailProviderEvent(env.DB, { svixId: 'b', emailId: 'em_1', status: 'accepted' });
  assert.equal(sqlite.prepare('SELECT status FROM email_deliveries').get().status, 'delivered');
});

test('a session or sign-in token belongs to exactly one client or admin', (t) => {
  const { sqlite } = createEnv(t);
  seedClient(sqlite);
  assert.throws(() => sqlite.exec("INSERT INTO sessions (id, expires_at) VALUES ('s', '2099-01-01')"));
  assert.throws(() =>
    sqlite.exec(
      "INSERT INTO sessions (id, client_id, admin_email, expires_at) VALUES ('s', 1, 'a@b.c', '2099-01-01')",
    ),
  );
  sqlite.exec("INSERT INTO sessions (id, admin_email, expires_at) VALUES ('s', 'a@b.c', '2099-01-01')");
});

test('the agent API needs the exact token, and only a long one', async () => {
  const { isAgentRequest } = await import('../src/lib/agent.js');
  const token = 'a'.repeat(40);
  const request = (value) =>
    new Request('https://desk.test/api/agent/tickets', { headers: value ? { authorization: value } : {} });
  assert.equal(isAgentRequest(request(`Bearer ${token}`), { AGENT_TOKEN: token }), true);
  assert.equal(isAgentRequest(request(`Bearer ${token}x`), { AGENT_TOKEN: token }), false);
  assert.equal(isAgentRequest(request(''), { AGENT_TOKEN: token }), false);
  assert.equal(
    isAgentRequest(request('Bearer short'), { AGENT_TOKEN: 'short' }),
    false,
    'a short token turns the API off',
  );
  assert.equal(isAgentRequest(request('Bearer '), {}), false);
});

test('an agent draft and note never reach the client on their own', async (t) => {
  const { saveAgentDraft, addAgentNote, requestForAgent } = await import('../src/lib/agent.js');
  const { env, sqlite } = createEnv(t);
  seedClient(sqlite);
  sqlite.exec(
    `INSERT INTO tickets (ref, client_id, title, body) VALUES ('SUP-1', 1, 'T', 'Please fix the footer');`,
  );
  const first = await saveAgentDraft(env.DB, 'SUP-1', { body: 'Fixed the footer link.' });
  assert.equal(first.ok, true);
  const blind = await saveAgentDraft(env.DB, 'SUP-1', { body: 'Overwrite without reading' });
  assert.equal(blind.status, 409);
  assert.equal(
    (await saveAgentDraft(env.DB, 'SUP-1', { body: 'Updated', expectedRevision: first.draft.revision })).ok,
    true,
  );
  assert.equal(
    (
      await addAgentNote(env.DB, 'SUP-1', {
        body: 'Changed footer.html line 12.',
        idempotencyKey: 'note-0001',
      })
    ).ok,
    true,
  );
  await addAgentNote(env.DB, 'SUP-1', { body: 'Changed footer.html line 12.', idempotencyKey: 'note-0001' });
  const view = await requestForAgent(env.DB, 'SUP-1', 'https://desk.test');
  assert.equal(view.draft.body, 'Updated');
  assert.equal(view.conversation.length, 1);
  assert.equal(view.conversation[0].private_note, true);
  assert.equal(view.status, 'new');
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE visibility = 'client'").get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM email_deliveries').get().n, 0);
});
