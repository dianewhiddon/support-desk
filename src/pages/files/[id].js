/* Download links in emails. The middleware sends a signed-out client through
   sign-in and back to this exact file. */
import { env } from 'cloudflare:workers';
import { attachmentResponse } from '../../lib/attachments.js';

export function GET(context) {
  return attachmentResponse(env, context.params.id, { clientId: context.locals.client.id });
}
