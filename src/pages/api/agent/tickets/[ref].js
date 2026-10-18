/* GET /api/agent/tickets/{ref}: the request, its whole conversation (private
   notes marked), file download links and the current reply draft. */
import { env } from 'cloudflare:workers';
import { isAgentRequest, requestForAgent } from '../../../../lib/agent.js';

export async function GET(context) {
  if (!isAgentRequest(context.request, env)) return new Response('Unauthorized', { status: 401 });
  const request = await requestForAgent(env.DB, context.params.ref, context.url.origin);
  return request
    ? Response.json({ ok: true, request })
    : Response.json({ ok: false, error: 'Request not found.' }, { status: 404 });
}
