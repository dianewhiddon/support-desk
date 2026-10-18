/* POST /api/agent/tickets/{ref}/state
   { "action": "resolve" | "dismiss" | "waiting" | "reopen", "revision": 4,
     "reason": "duplicate" | "not_needed", "duplicate_ref": "...", "note": "..." }
   Same rules as the request actions on the desk. Sends no message. */
import { env } from 'cloudflare:workers';
import { agentJson, changeStateForAgent } from '../../../../../lib/agent.js';

export function POST(context) {
  return agentJson(context.request, env, (input) => changeStateForAgent(env.DB, context.params.ref, input));
}
