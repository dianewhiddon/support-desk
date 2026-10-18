/* PUT /api/agent/tickets/{ref}/draft  { "body": "...", "draft_revision": 3 }
   Saves a reply draft for you to review. It is never sent automatically. */
import { env } from 'cloudflare:workers';
import { isAgentRequest, saveAgentDraft } from '../../../../../lib/agent.js';

export async function PUT(context) {
  if (!isAgentRequest(context.request, env)) return new Response('Unauthorized', { status: 401 });
  let input;
  try {
    input = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Send JSON.' }, { status: 400 });
  }
  const revision =
    input.draft_revision === undefined || input.draft_revision === null ? null : Number(input.draft_revision);
  const result = await saveAgentDraft(env.DB, context.params.ref, {
    body: input.body,
    expectedRevision: revision,
  });
  return Response.json(result, { status: result.status });
}
