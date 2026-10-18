/* POST: replace the reply draft with a fresh AI draft. Waits for Claude, then answers JSON. */
import { env } from 'cloudflare:workers';
import { draftReplyInVoice } from '../../../../../lib/ai-voice.js';

export async function POST(context) {
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return Response.json({ ok: false, error: 'The form could not be read.' }, { status: 400 });
  }
  const raw = String(form.get('draft_revision') || '');
  const result = await draftReplyInVoice(env, context.params.ref, {
    force: true,
    expectedRevision: raw === '' ? null : Number(raw),
  });
  const ref = encodeURIComponent(context.params.ref);
  if (result.ok)
    return Response.json({ ok: true, redirect: `/admin/tickets/${ref}?result=ai_draft#reply-heading` });
  return Response.json(
    { ok: false, error: result.error || 'The draft could not be written.' },
    { status: result.skipped === 'disabled' ? 400 : 409 },
  );
}
