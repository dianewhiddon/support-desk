/* GET /api/agent/files/{id}: download a request file for the agent. */
import { env } from 'cloudflare:workers';
import { isAgentRequest } from '../../../../lib/agent.js';
import { attachmentResponse } from '../../../../lib/attachments.js';

export function GET(context) {
  if (!isAgentRequest(context.request, env)) return new Response('Unauthorized', { status: 401 });
  return attachmentResponse(env, context.params.id, { privileged: true });
}
