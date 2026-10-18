import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, seedClient, recordingSender, pdfFile } from './helpers.js';
import { createRequest } from '../src/lib/requests.js';
import { saveReplyDraft, applyComposerAction, changeRequestState } from '../src/lib/workflow.js';
import { addReplyFile, removeReplyFile } from '../src/lib/reply-files.js';
import { sendTicketEmail } from '../src/lib/ticket-email.js';
import { getTicketByRef, getClientById } from '../src/lib/db.js';
import {
  saveAgentDraft,
  requestForAgent,
  sendApprovedReply,
  changeStateForAgent,
  agentJson,
} from '../src/lib/agent.js';

const origin = 'https://desk.test';

async function setup(t) {
  const { env, sqlite } = createEnv(t);
  const client = seedClient(sqlite);
  const { ref } = await createRequest(env, {
    client,
    origin,
    files: [],
    input: { type: 'change', submissionKey: 'k', body: 'Update the menu' },
  });
  const ticket = () => getTicketByRef(env.DB, ref);
  return { env, sqlite, client: await getClientById(env.DB, client.id), ref, ticket };
}

test('sending consumes the saved draft, publishes its files, moves the status and emails the client', async (t) => {
  const { env, sqlite, client, ticket } = await setup(t);
  const saved = await saveReplyDraft(env.DB, await ticket(), { body: 'Done. Menu updated.' });
  assert.equal(saved.ok, true);
  const upload = await addReplyFile(
    env,
    await ticket(),
    {
      draftId: saved.draft.id,
      draftRevision: saved.draft.revision,
      ticketRevision: (await ticket()).revision,
      idempotencyKey: 'upload-0001',
    },
    pdfFile('menu.pdf'),
  );
  assert.equal(upload.ok, true);
  const mail = recordingSender();
  const result = await applyComposerAction(
    env,
    origin,
    {
      ticket: await ticket(),
      client,
      action: 'send_reply',
      body: 'Done. Menu updated.',
      idempotencyKey: 'send-1',
      draftId: upload.draft.id,
      draftRevision: upload.draft.revision,
      after: 'done',
    },
    (e, args) => sendTicketEmail(e, args, mail.send),
  );
  assert.equal(result.ok, true);
  assert.equal(result.delivery.ok, true);
  const after = await ticket();
  assert.equal(after.status, 'done');
  assert.ok(after.resolved_at);
  assert.equal(sqlite.prepare('SELECT status FROM reply_drafts').get().status, 'sent');
  const file = sqlite.prepare('SELECT * FROM ticket_attachments').get();
  assert.equal(file.role, 'reply_sent');
  assert.equal(file.message_id, result.messageId);
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'sarah@example.com');
  assert.ok(!mail.sent[0].text.includes('Done. Menu updated.'), 'the reply body stays on the desk');
  assert.match(mail.sent[0].text, /\/files\/\d+/);
});

test('a repeated send click never sends twice', async (t) => {
  const { env, sqlite, client, ticket } = await setup(t);
  const saved = await saveReplyDraft(env.DB, await ticket(), { body: 'On it.' });
  const mail = recordingSender();
  const deliver = (e, args) => sendTicketEmail(e, args, mail.send);
  const args = {
    client,
    action: 'send_reply',
    body: 'On it.',
    idempotencyKey: 'same',
    draftId: saved.draft.id,
    draftRevision: saved.draft.revision,
  };
  const first = await applyComposerAction(env, origin, { ...args, ticket: await ticket() }, deliver);
  const second = await applyComposerAction(env, origin, { ...args, ticket: await ticket() }, deliver);
  assert.equal(first.ok && second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE author = 'owner'").get().n, 1);
  assert.equal(mail.sent.length, 1);
  assert.equal((await ticket()).status, 'waiting');
});

test('a failed email keeps the reply and can be retried from its frozen copy', async (t) => {
  const { env, sqlite, client, ticket } = await setup(t);
  const saved = await saveReplyDraft(env.DB, await ticket(), { body: 'Question for you inside.' });
  const down = recordingSender({ fail: true });
  const result = await applyComposerAction(
    env,
    origin,
    {
      ticket: await ticket(),
      client,
      action: 'send_reply',
      body: 'Question for you inside.',
      idempotencyKey: 'x',
      draftId: saved.draft.id,
      draftRevision: saved.draft.revision,
    },
    (e, args) => sendTicketEmail(e, args, down.send),
  );
  assert.equal(result.ok, true);
  assert.equal(result.delivery.ok, false);
  const delivery = sqlite.prepare("SELECT * FROM email_deliveries WHERE kind = 'reply'").get();
  assert.equal(delivery.status, 'failed');
  const up = recordingSender();
  const retry = await sendTicketEmail(
    env,
    {
      ticket: await ticket(),
      messageId: delivery.message_id,
      kind: delivery.kind,
      recipientEmail: delivery.recipient_email,
      payload: JSON.parse(delivery.payload_json),
      idempotencyKey: delivery.idempotency_key,
    },
    up.send,
  );
  assert.equal(retry.ok, true);
  assert.equal(up.sent[0].subject, down.sent[0].subject);
  assert.equal(
    sqlite.prepare("SELECT status FROM email_deliveries WHERE kind = 'reply'").get().status,
    'accepted',
  );
});

test('a stale form cannot overwrite a newer draft or send old text', async (t) => {
  const { env, client, ticket } = await setup(t);
  const first = await saveReplyDraft(env.DB, await ticket(), { body: 'Version one' });
  const second = await saveReplyDraft(env.DB, await ticket(), {
    body: 'Version two',
    draftId: first.draft.id,
    expectedRevision: first.draft.revision,
  });
  assert.equal(second.ok, true);
  const stale = await saveReplyDraft(env.DB, await ticket(), {
    body: 'Stale tab',
    draftId: first.draft.id,
    expectedRevision: first.draft.revision,
  });
  assert.equal(stale.ok, false);
  const wrongText = await applyComposerAction(
    env,
    origin,
    {
      ticket: await ticket(),
      client,
      action: 'send_reply',
      body: 'Version one',
      idempotencyKey: 'y',
      draftId: second.draft.id,
      draftRevision: second.draft.revision,
    },
    async () => ({ ok: true }),
  );
  assert.equal(wrongText.ok, false);
});

test('private notes never reach the client and send no email', async (t) => {
  const { env, sqlite, client, ticket } = await setup(t);
  let called = false;
  const result = await applyComposerAction(
    env,
    origin,
    {
      ticket: await ticket(),
      client,
      action: 'save_note',
      body: 'Check the theme settings first.',
      idempotencyKey: 'note-1',
    },
    async () => {
      called = true;
      return { ok: true };
    },
  );
  assert.equal(result.ok, true);
  assert.equal(called, false);
  assert.equal(sqlite.prepare('SELECT visibility FROM messages').get().visibility, 'internal');
  assert.equal((await ticket()).status, 'new');
});

test('request actions: resolve, reopen, waiting, and dismiss rules', async (t) => {
  const { env, sqlite, client, ref, ticket } = await setup(t);
  assert.equal((await changeRequestState(env.DB, ref, { action: 'resolve', expectedRevision: 0 })).ok, true);
  assert.equal((await ticket()).status, 'done');
  assert.equal(
    (await changeRequestState(env.DB, ref, { action: 'resolve', expectedRevision: 1 })).ok,
    false,
    'already closed',
  );
  assert.equal((await changeRequestState(env.DB, ref, { action: 'reopen', expectedRevision: 1 })).ok, true);
  assert.equal((await ticket()).status, 'open');
  assert.equal(
    (await changeRequestState(env.DB, ref, { action: 'waiting', expectedRevision: 0 })).ok,
    false,
    'stale revision',
  );
  assert.equal(
    (await changeRequestState(env.DB, ref, { action: 'dismiss', reason: 'addressed', expectedRevision: 2 }))
      .status,
    400,
  );
  const other = await createRequest(env, {
    client,
    origin,
    files: [],
    input: { type: 'change', submissionKey: 'k2', body: 'Update the menu again' },
  });
  const dismissed = await changeRequestState(env.DB, other.ref, {
    action: 'dismiss',
    reason: 'duplicate',
    duplicateRef: ref,
    expectedRevision: 0,
  });
  assert.equal(dismissed.ok, true);
  const row = await getTicketByRef(env.DB, other.ref);
  assert.equal(row.status, 'closed');
  assert.equal(row.duplicate_of_ticket_id, (await ticket()).id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type = 'request_state'").get().n, 3);
});

test('a removed draft file is never published', async (t) => {
  const { env, sqlite, client, ticket } = await setup(t);
  const saved = await saveReplyDraft(env.DB, await ticket(), { body: 'See attached.' });
  const added = await addReplyFile(
    env,
    await ticket(),
    {
      draftId: saved.draft.id,
      draftRevision: saved.draft.revision,
      ticketRevision: 0,
      idempotencyKey: 'upload-0002',
    },
    pdfFile(),
  );
  const removed = await removeReplyFile(
    env,
    await ticket(),
    { draftId: added.draft.id, draftRevision: added.draft.revision, ticketRevision: 0 },
    added.attachment_id,
  );
  assert.equal(removed.ok, true);
  await applyComposerAction(
    env,
    origin,
    {
      ticket: await ticket(),
      client,
      action: 'send_reply',
      body: 'See attached.',
      idempotencyKey: 'z',
      draftId: removed.draft.id,
      draftRevision: removed.draft.revision,
    },
    async () => ({ ok: true, providerMessageId: 'p' }),
  );
  assert.equal(sqlite.prepare('SELECT role FROM ticket_attachments').get().role, 'reply_removed');
});

test('an empty first Save draft is refused unless it opens a draft for files', async (t) => {
  const { env, sqlite, ticket } = await setup(t);
  const empty = await saveReplyDraft(env.DB, await ticket(), { body: '   ' });
  assert.equal(empty.ok, false);
  assert.equal(empty.status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM reply_drafts').get().n, 0);
  const forFiles = await saveReplyDraft(env.DB, await ticket(), { body: '', forFiles: true });
  assert.equal(forFiles.ok, true);
  const cleared = await saveReplyDraft(env.DB, await ticket(), {
    body: '',
    draftId: forFiles.draft.id,
    expectedRevision: forFiles.draft.revision,
  });
  assert.equal(cleared.ok, true, 'clearing a saved draft is still allowed');
});

const TOKEN = 'a'.repeat(40);
const agentRequest = (input, token = TOKEN) =>
  new Request('https://desk.test/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(input),
  });

/** A request with an agent-saved draft, read back the way an agent reads it. */
async function agentSetup(t) {
  const { env, sqlite } = createEnv(t, { AGENT_TOKEN: TOKEN });
  const seeded = seedClient(sqlite);
  const { ref } = await createRequest(env, {
    client: seeded,
    origin,
    files: [],
    input: { type: 'change', submissionKey: 'k', body: 'Add the new podcast episode' },
  });
  const reply = 'Hi Sarah, the episode is on your Podcast page now.';
  assert.equal((await saveAgentDraft(env.DB, ref, { body: reply })).ok, true);
  const view = await requestForAgent(env.DB, ref, origin);
  const mail = recordingSender();
  const send = (input, token) =>
    agentJson(agentRequest(input, token), env, (body) =>
      sendApprovedReply(env, origin, ref, body, (e, args) => sendTicketEmail(e, args, mail.send)),
    );
  const approved = {
    ticket_revision: view.revision,
    draft_id: view.draft.id,
    draft_revision: view.draft.revision,
    body: reply,
    idempotency_key: 'chat-approval-1',
  };
  return { env, sqlite, ref, reply, view, mail, send, approved, ticket: () => getTicketByRef(env.DB, ref) };
}

test('the agent sends only the exact approved draft, once, and can resolve in the same call', async (t) => {
  const { sqlite, reply, mail, send, approved, ticket } = await agentSetup(t);
  assert.equal((await send({ ...approved, then: 'resolve' }, null)).status, 401);
  assert.equal((await send({ ...approved, then: 'resolve' }, `${TOKEN}x`)).status, 401);
  const changed = await send({ ...approved, body: `${reply} Extra words nobody approved.`, then: 'resolve' });
  assert.equal(changed.status, 409);
  assert.match((await changed.json()).error, /Nothing was sent/);
  assert.equal(
    (await send({ ...approved, draft_revision: approved.draft_revision + 1, then: 'resolve' })).status,
    409,
  );
  assert.equal(
    (await send({ ...approved, ticket_revision: approved.ticket_revision + 1, then: 'resolve' })).status,
    409,
  );
  assert.equal((await send({ ...approved, then: 'open' })).status, 400);
  assert.equal(mail.sent.length, 0, 'nothing that differs from the saved draft reaches the client');
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE visibility = 'client'").get().n, 0);

  const sent = await send({ ...approved, then: 'resolve', note: 'Episode added to the Podcast page.' });
  const result = await sent.json();
  assert.equal(sent.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.delivery.ok, true);
  assert.deepEqual(result.state, { ok: true, action: 'resolve', status: 'done' });
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'sarah@example.com');
  assert.match(mail.sent[0].subject, /Kyle replied to your request/);
  assert.equal(
    sqlite.prepare("SELECT body FROM messages WHERE visibility = 'client' AND author = 'owner'").get().body,
    reply,
  );
  const after = await ticket();
  assert.equal(after.status, 'done');
  assert.equal(after.resolution_note, 'Episode added to the Podcast page.');
  assert.equal(sqlite.prepare('SELECT status FROM reply_drafts').get().status, 'sent');

  const replay = await (await send({ ...approved, then: 'resolve' })).json();
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.ok, true);
  assert.equal(
    mail.sent.length,
    1,
    'a repeated instruction never sends twice, even after the request closed',
  );
});

test('when the reply is sent but the request is not where the agent asked, the answer still says it was sent', async (t) => {
  const { env, mail, send, approved, ref, ticket } = await agentSetup(t);
  const first = await (await send({ ...approved, then: 'waiting' })).json();
  assert.equal(first.ok, true);
  assert.equal(first.state.ok, true);
  assert.equal((await ticket()).status, 'waiting');
  // The owner dismisses it on the desk; the agent then repeats the instruction asking to resolve.
  assert.equal(
    (
      await changeRequestState(env.DB, ref, {
        action: 'dismiss',
        reason: 'not_needed',
        expectedRevision: (await ticket()).revision,
      })
    ).ok,
    true,
  );
  const response = await send({ ...approved, then: 'resolve' });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true, 'the reply was sent, so the agent must not resend it');
  assert.equal(result.replayed, true);
  assert.equal(result.state.ok, false);
  assert.match(result.state.error, /The reply was sent/);
  assert.equal((await ticket()).status, 'closed', 'an old instruction never moves the request');
  assert.equal(mail.sent.length, 1);
});

test('the agent changes request state with the desk guards', async (t) => {
  const { env, ref, ticket } = await agentSetup(t);
  const state = (input, token = TOKEN) =>
    agentJson(agentRequest(input, token), env, (body) => changeStateForAgent(env.DB, ref, body));
  assert.equal((await state({ action: 'resolve', revision: 0 }, null)).status, 401);
  const revision = (await ticket()).revision;
  assert.equal((await state({ action: 'resolve', revision: revision + 1 })).status, 409);
  assert.equal((await state({ action: 'dismiss', reason: 'addressed', revision })).status, 400);
  assert.equal(
    (await state({ action: 'reopen', revision })).status,
    409,
    'an open request cannot be reopened',
  );
  const resolved = await state({ action: 'resolve', revision, note: 'Done from chat.' });
  assert.equal(resolved.status, 200);
  assert.equal((await ticket()).status, 'done');
  const reopened = await (await state({ action: 'reopen', revision: revision + 1 })).json();
  assert.equal(reopened.ok, true);
  assert.equal((await ticket()).status, 'open');
  const bad = await agentJson(
    new Request('https://desk.test/x', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: 'not json',
    }),
    env,
    async () => ({ ok: true }),
  );
  assert.equal(bad.status, 400);
});
