/* Admin download of any request file, including unsent reply drafts. */
import { env } from 'cloudflare:workers';
import { attachmentResponse } from '../../../../lib/attachments.js';

export function GET(context) {
  return attachmentResponse(env, context.params.id, { privileged: true });
}
