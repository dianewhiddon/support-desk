/* POST /api/login: request a magic link. Every valid request gets the same
   "check your inbox" answer, so the form never reveals who has an account.
   Abuse limits: a honeypot field, optional Turnstile, and no more than five
   attempts per IP address every ten minutes. */
import { env } from 'cloudflare:workers';
import { appConfig } from '../../lib/config.js';
import { issueMagicLink, clientIp, userAgent, safeNextPath } from '../../lib/auth.js';
import { sendEmail, magicLinkEmail } from '../../lib/email.js';
import { logEvent, gcAuthTables } from '../../lib/db.js';

import { validEmail } from '../../lib/validate.js';

import { allowLogin } from '../../lib/login-limits.js';

async function verifyTurnstile(context, form) {
  const config = appConfig(env);
  if (!config.turnstileSiteKey) return 'verified';
  if (!env.TURNSTILE_SECRET) return 'unavailable';
  const token = String(form.get('cf-turnstile-response') || '');
  if (!token) return 'required';
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: clientIp(context) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return 'unavailable';
    return (await response.json()).success === true ? 'verified' : 'retry';
  } catch {
    return 'unavailable';
  }
}

export async function POST(context) {
  let form = null;
  try {
    form = await context.request.formData();
  } catch {
    /* handled below */
  }
  const email = String(form?.get('email') || '').trim();
  const next = safeNextPath(form?.get('next'));
  const redirect = (query) => {
    const target = new URL(`/login?${query}`, context.url);
    if (next) target.searchParams.set('next', next);
    return context.redirect(`${target.pathname}${target.search}`, 303);
  };

  const cleanup = gcAuthTables(env.DB).catch(() => {});
  const cf = context.locals?.cfContext;
  if (cf?.waitUntil) cf.waitUntil(cleanup);
  else await cleanup;

  if (!form || !validEmail(email)) return redirect('error=email');
  // Bots fill every field; people never see this one.
  if (String(form.get('website') || '')) return redirect('sent=1');
  const verification = await verifyTurnstile(context, form);
  if (verification !== 'verified') return redirect(`verification=${verification}`);

  const ip = clientIp(context);
  const allowed = await allowLogin(env.DB, email, ip);
  await logEvent(env.DB, 'login_attempt', { ip, userAgent: userAgent(context) });
  if (allowed) {
    const link = await issueMagicLink(email, context.url.origin, next);
    if (link) {
      const delivery = await sendEmail(env, magicLinkEmail(env, link));
      await logEvent(env.DB, delivery.ok ? 'magic_delivery_accepted' : 'magic_delivery_failed', {
        data: { status: Number.isInteger(delivery.status) ? delivery.status : null },
      });
    }
  }
  return redirect('sent=1');
}
