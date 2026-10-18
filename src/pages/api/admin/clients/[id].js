/* POST: update a client's details, add a website, or turn one on or off. */
import { env } from 'cloudflare:workers';
import {
  getClientById,
  updateClient,
  updateClientAiNotes,
  createSite,
  setSiteActive,
  normalizeEmail,
  logEvent,
} from '../../../../lib/db.js';
import { validEmail, validTimeZone, validWebAddress } from '../../../../lib/validate.js';

export async function POST(context) {
  const client = await getClientById(env.DB, Number(context.params.id));
  if (!client) return context.redirect('/admin/clients', 303);
  const back = (query) => context.redirect(`/admin/clients/${client.id}?${query}`, 303);
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return back('error=form');
  }
  const action = String(form.get('action') || '');

  if (action === 'update') {
    const email = normalizeEmail(form.get('email'));
    if (!validEmail(email)) return back('error=email');
    const timeZone = String(form.get('time_zone') || '').trim();
    if (timeZone && !validTimeZone(timeZone)) return back('error=timezone');
    try {
      await updateClient(env.DB, client.id, {
        email,
        name: String(form.get('name') || '')
          .trim()
          .slice(0, 120),
        company: String(form.get('company') || '')
          .trim()
          .slice(0, 160),
        timeZone,
        active: form.get('active') === '1',
      });
    } catch {
      return back('error=exists');
    }
    await logEvent(env.DB, 'client_updated', {
      clientId: client.id,
      data: { by: context.locals.admin.email },
    });
    return back('saved=1');
  }

  if (action === 'ai_notes') {
    await updateClientAiNotes(
      env.DB,
      client.id,
      String(form.get('ai_notes') || '')
        .trim()
        .slice(0, 20000),
    );
    return back('saved=1');
  }

  if (action === 'add_site') {
    const label = String(form.get('label') || '')
      .trim()
      .slice(0, 120);
    const url = String(form.get('url') || '').trim();
    if ((!label && !url) || (url && !validWebAddress(url))) return back('error=site');
    await createSite(env.DB, { clientId: client.id, label, url });
    return back('saved=1');
  }

  if (action === 'toggle_site') {
    await setSiteActive(env.DB, {
      siteId: Number(form.get('site_id')),
      clientId: client.id,
      active: form.get('active') === '1',
    });
    return back('saved=1');
  }

  return back('error=form');
}
