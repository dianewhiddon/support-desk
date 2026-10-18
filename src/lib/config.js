/* Every business-specific value comes from wrangler.jsonc vars, so a fork
   changes configuration, not code. Callers pass the Worker env. */

const text = (value, fallback) => {
  const clean = String(value ?? '').trim();
  return clean || fallback;
};

export function appConfig(env = {}) {
  const businessName = text(env.BUSINESS_NAME, 'Support');
  return {
    businessName,
    ownerName: text(env.OWNER_NAME, businessName),
    ownerEmail: text(env.OWNER_EMAIL, ''),
    adminEmails: text(env.ADMIN_EMAILS, '')
      .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
    emailFrom: text(env.EMAIL_FROM, ''),
    noReply: text(env.EMAIL_NO_REPLY, ''),
    timeZone: text(env.DEFAULT_TIME_ZONE, 'America/Chicago'),
    ticketPrefix: text(env.TICKET_PREFIX, 'SUP').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'SUP',
    turnstileSiteKey: text(env.TURNSTILE_SITE_KEY, ''),
  };
}

export function isAdminEmail(env, email) {
  const clean = String(email || '').trim().toLowerCase();
  return !!clean && appConfig(env).adminEmails.includes(clean);
}
