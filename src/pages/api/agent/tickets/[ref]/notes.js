/* POST /api/agent/tickets/{ref}/notes  { "body": "...", "idempotency_key": "..." }
   Adds a private note. Clients never see notes. */
import { env } from 'cloudflare:workers';
import { isAgentRequest, addAgentNote } from '../../../../../lib/agent.js';

export async function POST(context) {
  if (!isAgentRequest(context.request, env)) return new Response('Unauthorized', { status: 401 });
  let input;
  try { input = await context.request.json(); } catch { return Response.json({ ok: false, error: 'Send JSON.' }, { status: 400 }); }
  const result = await addAgentNote(env.DB, context.params.ref, { body: input.body, idempotencyKey: input.idempotency_key });
  return Response.json(result, { status: result.status });
}
