/* GET /api/agent/tickets: open requests, urgent first, then oldest. */
import { env } from 'cloudflare:workers';
import { isAgentRequest, listOpenRequests } from '../../../lib/agent.js';

export async function GET(context) {
  if (!isAgentRequest(context.request, env)) return new Response('Unauthorized', { status: 401 });
  return Response.json({ ok: true, requests: await listOpenRequests(env.DB) });
}
