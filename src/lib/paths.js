/** Keep post-sign-in destinations on this site, as a path only. */
export function safeNextPath(raw, fallback = '') {
  const value = String(raw || '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const base = 'https://desk.invalid';
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
