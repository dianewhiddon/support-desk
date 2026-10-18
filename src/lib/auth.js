/* Sign-in by emailed magic link, then an opaque cookie session stored in D1.
   Session ids are 40 random characters validated on every request, so there
   is nothing to forge. Magic links are single-use and expire in 30 minutes.
   Addresses listed in ADMIN_EMAILS get an admin session; everyone else must
   be an active client. */
import { env } from 'cloudflare:workers';
import { newSessionId, newToken } from './ids.js';
import { isAdminEmail } from './config.js';
import { safeNextPath } from './paths.js';
import {
  getClientByEmail, getClientById, createMagicToken, consumeMagicToken,
  createSession, getSession, deleteSession, logEvent, normalizeEmail,
} from './db.js';

export { safeNextPath };
export const SESSION_COOKIE = 'sd_session';
const MAGIC_TTL_MINUTES = 30;
const SESSION_TTL_DAYS = 30;

const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60_000);
const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000);

/** Returns { session, client } or { session, admin } for the signed-in visitor, or null. */
export async function getCurrentSession(context) {
  const sid = context.cookies.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const session = await getSession(env.DB, sid);
  if (!session) return null;
  if (session.admin_email) {
    // Removing an address from ADMIN_EMAILS revokes its sessions immediately.
    return isAdminEmail(env, session.admin_email) ? { session, admin: { email: session.admin_email } } : null;
  }
  const client = await getClientById(env.DB, session.client_id);
  return client?.active ? { session, client } : null;
}

export async function getCurrentClient(context) {
  return (await getCurrentSession(context))?.client || null;
}

/** Create a magic link for an address. Returns null when the address belongs to
    no admin and no active client; callers show the same acknowledgement either
    way, so the form never reveals who has an account. */
export async function issueMagicLink(email, origin, next = '') {
  const address = normalizeEmail(email);
  const admin = isAdminEmail(env, address);
  const client = admin ? null : await getClientByEmail(env.DB, address);
  if (!admin && !client) return null;
  const token = newToken(32);
  await createMagicToken(env.DB, {
    token,
    clientId: client?.id ?? null,
    adminEmail: admin ? address : null,
    expiresAt: minutesFromNow(MAGIC_TTL_MINUTES).toISOString(),
  });
  await logEvent(env.DB, 'magic_requested', { clientId: client?.id ?? null, data: admin ? { admin: true } : null });
  const url = new URL(`/auth/${token}`, origin);
  const destination = safeNextPath(next);
  if (destination) url.searchParams.set('next', destination);
  return { email: address, name: client?.name || null, admin, url: url.toString() };
}

/** Consume a magic token and open a session. Returns 'admin', 'client' or null. */
export async function consumeMagicAndLogin(context, token) {
  const owner = await consumeMagicToken(env.DB, token);
  if (!owner) return null;
  if (owner.adminEmail && !isAdminEmail(env, owner.adminEmail)) return null;
  if (owner.clientId) {
    const client = await getClientById(env.DB, owner.clientId);
    if (!client?.active) return null;
  }
  const id = newSessionId();
  const expires = daysFromNow(SESSION_TTL_DAYS);
  await createSession(env.DB, { id, clientId: owner.clientId, adminEmail: owner.adminEmail, expiresAt: expires.toISOString() });
  context.cookies.set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: !import.meta.env.DEV,
    sameSite: 'lax',
    path: '/',
    expires,
  });
  await logEvent(env.DB, 'login', {
    clientId: owner.clientId, ip: clientIp(context), userAgent: userAgent(context),
    data: owner.adminEmail ? { admin: true } : null,
  });
  return owner.adminEmail ? 'admin' : 'client';
}

export async function logout(context) {
  const sid = context.cookies.get(SESSION_COOKIE)?.value;
  if (sid) await deleteSession(env.DB, sid);
  context.cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function clientIp(context) {
  return context.request.headers.get('cf-connecting-ip') || null;
}
export function userAgent(context) {
  return context.request.headers.get('user-agent') || null;
}
