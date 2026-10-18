/* POST: resolve, dismiss, mark waiting, or reopen. Answers JSON. */
import { env } from 'cloudflare:workers';
import { changeRequestState } from '../../../../../lib/workflow.js';

export async function POST(context) {
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return Response.json({ ok: false, error: 'The form could not be read.' }, { status: 400 });
  }
  const result = await changeRequestState(env.DB, context.params.ref, {
    action: String(form.get('action') || ''),
    expectedRevision: Number(form.get('revision')),
    reason: String(form.get('reason') || ''),
    note: String(form.get('note') || ''),
    duplicateRef: String(form.get('duplicate_ref') || ''),
  });
  return Response.json(
    {
      ...result,
      redirect: result.ok
        ? `/admin/tickets/${encodeURIComponent(context.params.ref)}?result=${result.action}`
        : null,
    },
    { status: result.status },
  );
}
