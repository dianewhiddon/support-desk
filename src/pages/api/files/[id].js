/* A client downloads a file on one of their own requests. */
import { env } from 'cloudflare:workers';
import { attachmentResponse } from '../../../lib/attachments.js';

export function GET(context) {
  return attachmentResponse(env, context.params.id, { clientId: context.locals.client.id });
}
