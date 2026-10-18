/* POST /api/agent/tickets/{ref}/send
   { "ticket_revision": 4, "draft_id": 7, "draft_revision": 2, "body": "...",
     "idempotency_key": "...", "then": "waiting" | "resolve", "note": "..." }
   Sends the saved draft the owner approved, through the desk's own Send step.
   Only an exact match of the saved draft goes out; a repeated key never sends twice. */
import { env } from 'cloudflare:workers';
import { agentJson, sendApprovedReply } from '../../../../../lib/agent.js';

export function POST(context) {
  return agentJson(context.request, env, (input) => sendApprovedReply(env, context.url.origin, context.params.ref, input));
}
