/* POST /api/tickets: a client opens a request. */
import { env } from 'cloudflare:workers';
import { clientIp, userAgent } from '../../lib/auth.js';
import { createRequest, afterResponse } from '../../lib/requests.js';
import { formFiles } from '../../lib/uploads.js';

export async function POST(context) {
  const client = context.locals.client;
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect('/tickets/new?err=failed', 303);
  }
  const type = String(form.get('type') || 'change');
  const result = await createRequest(env, {
    client,
    files: formFiles(form),
    origin: context.url.origin,
    ip: clientIp(context),
    userAgent: userAgent(context),
    input: {
      type,
      emergency: form.get('emergency') === '1',
      submissionKey: form.get('submission_key'),
      body: form.get('body'),
      siteId: form.get('site_id'),
      page: form.get('page'),
      links: form.get('links'),
    },
  });
  if (!result.ok)
    return context.redirect(
      `/tickets/new?err=${result.error}&type=${type === 'question' ? 'question' : 'change'}`,
      303,
    );
  if (!result.replayed) {
    // No reply is drafted here: the reply is written after the work is done.
    await afterResponse(context, result.notify);
  }
  return context.redirect(`/tickets/${result.ref}?created=1`, 303);
}
