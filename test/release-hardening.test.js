import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, seedClient, pngFile } from './helpers.js';
import {
  createMagicToken,
  consumeMagicToken,
  createSession,
  getSession,
  deleteSession,
  gcAuthTables,
  recordEmailProviderEvent,
  markEmailAccepted,
} from '../src/lib/db.js';
import { allowedOrigin, privateResponse, boundedRequest, BodyTooLarge } from '../src/lib/http-security.js';
import { allowLogin } from '../src/lib/login-limits.js';
import { createRequest, addClientReply } from '../src/lib/requests.js';
import { sendTicketEmail } from '../src/lib/ticket-email.js';
import { validateTicketFile } from '../src/lib/uploads.js';
import { validateReplyFile } from '../src/lib/reply-files.js';
import { officeFile } from './helpers.js';

test('magic links are hashed, expire, and cannot be consumed twice', async (t) => {
  const { env, sqlite } = createEnv(t);
  seedClient(sqlite);
  await createMagicToken(env.DB, {
    token: 'raw-secret',
    clientId: 1,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  assert.notEqual(sqlite.prepare('SELECT token FROM magic_tokens').get().token, 'raw-secret');
  assert.equal(await consumeMagicToken(env.DB, 'wrong'), null);
  assert.deepEqual(await consumeMagicToken(env.DB, 'raw-secret'), { clientId: 1, adminEmail: null });
  assert.equal(await consumeMagicToken(env.DB, 'raw-secret'), null);
  await createMagicToken(env.DB, {
    token: 'expired',
    clientId: 1,
    expiresAt: new Date(Date.now() - 1).toISOString(),
  });
  assert.equal(await consumeMagicToken(env.DB, 'expired'), null);
});

test('session storage, lookup, revocation and ISO-date cleanup agree', async (t) => {
  const { env, sqlite } = createEnv(t);
  seedClient(sqlite);
  await createSession(env.DB, {
    id: 'raw-session',
    clientId: 1,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const stored = sqlite.prepare('SELECT id FROM sessions').get().id;
  assert.notEqual(stored, 'raw-session');
  assert.equal((await getSession(env.DB, 'raw-session')).client_id, 1);
  assert.equal(await getSession(env.DB, stored), null, 'a database digest cannot authenticate');
  await deleteSession(env.DB, 'raw-session');
  assert.equal(await getSession(env.DB, 'raw-session'), null);
  await createSession(env.DB, {
    id: 'expired',
    clientId: 1,
    expiresAt: new Date(Date.now() - 60000).toISOString(),
  });
  await gcAuthTables(env.DB);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sessions').get().n, 0);
});

test('cookie writes reject missing, null and cross-site origins', () => {
  const request = (origin) =>
    new Request('https://desk.test/api/tickets', { method: 'POST', headers: origin ? { origin } : {} });
  for (const value of [null, 'null', 'https://evil.test', 'https://desk.test.evil.test'])
    assert.equal(allowedOrigin(request(value)), false);
  assert.equal(allowedOrigin(request('https://desk.test')), true);
  assert.equal(
    allowedOrigin(new Request('https://desk.test/api/agent/tickets/X/draft', { method: 'PUT' })),
    true,
  );
});

test('private responses do not leak referrers or replace the file sandbox', () => {
  const result = privateResponse(
    new Response('file', { headers: { 'content-security-policy': "sandbox; default-src 'none'" } }),
  );
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(result.headers.get('content-security-policy'), "sandbox; default-src 'none'");
});

test('body limits apply to chunked bodies as well as Content-Length', async () => {
  const url = 'https://desk.test/api/login';
  await assert.rejects(
    boundedRequest(
      new Request(url, { method: 'POST', body: 'small', headers: { 'content-length': '999999' } }),
    ),
    BodyTooLarge,
  );
  await assert.rejects(
    boundedRequest(new Request(url, { method: 'POST', body: 'x'.repeat(131073) })),
    BodyTooLarge,
  );
  const result = await boundedRequest(new Request(url, { method: 'POST', body: 'email=one%40example.com' }));
  assert.equal(await result.text(), 'email=one%40example.com');
});

test('login limits apply by address even when source IP changes', async (t) => {
  const { env } = createEnv(t);
  for (let i = 0; i < 5; i++) assert.equal(await allowLogin(env.DB, 'A@example.com', `ip-${i}`, 1000), true);
  assert.equal(await allowLogin(env.DB, 'a@example.com', 'new-ip', 1000), false);
  assert.equal(await allowLogin(env.DB, 'a@example.com', 'new-ip', 601000), true);
});

test('client and owner Office validation reject renamed macro and fake ZIP packages', async () => {
  for (const validate of [validateTicketFile, validateReplyFile]) {
    assert.equal((await validate(officeFile(['[Content_Types].xml', 'word/document.xml']))).ok, true);
    assert.equal(
      (await validate(officeFile(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']))).ok,
      false,
    );
    assert.equal((await validate(officeFile(['[Content_Types].xml', '../word/document.xml']))).ok, false);
    assert.equal(
      (await validate(new File(['PK\x03\x04'], 'file.docx', { type: 'application/octet-stream' }))).ok,
      false,
    );
  }
  assert.equal((await validateTicketFile(pngFile('bad\nname.png'))).ok, false);
});

test('new requests and replies persist notifications before background work', async (t) => {
  const { env, sqlite } = createEnv(t);
  const client = seedClient(sqlite);
  const created = await createRequest(env, {
    client,
    files: [],
    origin: 'https://desk.test',
    input: { body: 'Update the footer', submissionKey: 'crash-test' },
  });
  assert.equal(created.ok, true);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM email_deliveries WHERE status = 'pending'").get().n, 2);
  const ticket = sqlite.prepare('SELECT * FROM tickets').get();
  await addClientReply(env, {
    client,
    ticket,
    files: [],
    origin: 'https://desk.test',
    input: { body: 'Here is the final wording', idempotencyKey: 'reply-test' },
  });
  assert.equal(sqlite.prepare('SELECT count(*) n FROM email_deliveries').get().n, 3);
});

test('unconfirmed old email attempts and accepted provider failures are never blindly resent', async (t) => {
  const { env, sqlite } = createEnv(t);
  seedClient(sqlite);
  sqlite.exec("INSERT INTO tickets (ref, client_id, title, body) VALUES ('SUP-1', 1, 'T', 'B')");
  const params = {
    ticket: { id: 1, client_id: 1 },
    payload: { to: 'one@example.com', subject: 'Test' },
    kind: 'test',
    recipientEmail: 'one@example.com',
    idempotencyKey: 'test-key',
  };
  await sendTicketEmail(env, params, async () => ({ ok: false }));
  sqlite.exec("UPDATE email_deliveries SET created_at = datetime('now', '-2 days')");
  let calls = 0;
  const sender = async () => {
    calls++;
    return { ok: true };
  };
  assert.equal((await sendTicketEmail(env, params, sender)).ok, false);
  assert.equal(calls, 0);
  sqlite.exec("UPDATE email_deliveries SET status = 'failed', provider_message_id = 'accepted-then-failed'");
  await sendTicketEmail(env, params, sender);
  assert.equal(calls, 0);
});

test('an early webhook is reconciled when provider acceptance is recorded', async (t) => {
  const { env, sqlite } = createEnv(t);
  seedClient(sqlite);
  sqlite.exec("INSERT INTO tickets (ref, client_id, title, body) VALUES ('SUP-1', 1, 'T', 'B')");
  await sendTicketEmail(
    env,
    {
      ticket: { id: 1, client_id: 1 },
      payload: { to: 'one@example.com', subject: 'Test' },
      kind: 'test',
      recipientEmail: 'one@example.com',
      idempotencyKey: 'early-test',
    },
    async () => ({ ok: false }),
  );
  await recordEmailProviderEvent(env.DB, {
    svixId: 'early',
    eventType: 'email.delivered',
    emailId: 'provider-early',
    eventAt: new Date().toISOString(),
    status: 'delivered',
  });
  await markEmailAccepted(env.DB, 1, 'provider-early');
  assert.equal(sqlite.prepare('SELECT status FROM email_deliveries').get().status, 'delivered');
  await recordEmailProviderEvent(env.DB, {
    svixId: 'late-sent',
    eventType: 'email.sent',
    emailId: 'provider-early',
    eventAt: new Date().toISOString(),
    status: 'accepted',
  });
  assert.equal(sqlite.prepare('SELECT status FROM email_deliveries').get().status, 'delivered');
});
