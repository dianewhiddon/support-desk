/* POST: add a client. */
import { env } from 'cloudflare:workers';
import { createClient, normalizeEmail, logEvent } from '../../../../lib/db.js';
import { validEmail } from '../../../../lib/validate.js';

export async function POST(context) {
  let form;
  try { form = await context.request.formData(); } catch { return context.redirect('/admin/clients?error=email', 303); }
  const email = normalizeEmail(form.get('email'));
  if (!validEmail(email)) return context.redirect('/admin/clients?error=email', 303);
  let id;
  try {
    id = await createClient(env.DB, {
      email,
      name: String(form.get('name') || '').trim().slice(0, 120),
      company: String(form.get('company') || '').trim().slice(0, 160),
    });
  } catch {
    return context.redirect('/admin/clients?error=exists', 303);
  }
  await logEvent(env.DB, 'client_created', { clientId: id, data: { by: context.locals.admin.email } });
  return context.redirect(`/admin/clients/${id}?saved=1`, 303);
}
