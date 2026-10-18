/* Route guards.
   - /admin*, /api/admin*  -> an admin session (an address in ADMIN_EMAILS).
   - client routes         -> an active client session.
   - everything else       -> public: sign-in, magic-link consume, webhooks, assets.
   Every mutating request must also come from this site (Origin check), on top
   of the SameSite=Lax session cookie. Webhooks verify their own signature. */
import { defineMiddleware } from 'astro:middleware';
import { getCurrentSession } from './lib/auth.js';
import { allowedOrigin } from './lib/http-security.js';

const CLIENT_PREFIXES = ['/dashboard', '/tickets', '/api/tickets', '/api/files', '/files'];

const matches = (path, prefixes) =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (!allowedOrigin(context.request)) {
    return new Response('Forbidden', { status: 403 });
  }

  const adminRoute = matches(path, ['/admin', '/api/admin']);
  const clientRoute = matches(path, CLIENT_PREFIXES);
  if (!adminRoute && !clientRoute) return next();

  const current = await getCurrentSession(context);
  const allowed = adminRoute ? current?.admin : current?.client;
  if (!allowed) {
    if (path.startsWith('/api/')) return new Response('Unauthorized', { status: 401 });
    // A signed-in admin opening a client page, or the reverse, goes home.
    if (current?.admin) return context.redirect('/admin');
    if (current?.client) return context.redirect('/dashboard');
    return context.redirect(`/login?next=${encodeURIComponent(`${path}${context.url.search}`)}`);
  }
  if (current.admin) context.locals.admin = current.admin;
  else context.locals.client = current.client;
  return next();
});
