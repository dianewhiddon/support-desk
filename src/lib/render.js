/* Presentation helpers shared by client and admin pages. */

export function clientStatusLabel(ticket, ownerName) {
  if (ticket.status === 'closed') return 'Closed';
  if (ticket.type === 'question') {
    return { waiting: 'Your turn', done: 'Answered' }[ticket.status] || 'Asked';
  }
  return {
    new: 'Received',
    open: `With ${ownerName}`,
    waiting: 'Waiting on you',
    done: 'Done',
  }[ticket.status] || ticket.status;
}

export function adminStatusLabel(ticket) {
  return {
    new: 'New',
    open: 'Client replied',
    waiting: 'Waiting on client',
    done: 'Resolved',
    closed: 'Dismissed',
  }[ticket.status] || ticket.status;
}

/** D1 stores 'YYYY-MM-DD HH:MM:SS' in UTC; JavaScript writes ISO strings. */
export function parseStoredDate(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fmtDateTime(value, timeZone = 'America/Chicago') {
  const date = parseStoredDate(value);
  if (!date) return '';
  const options = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone };
  try { return new Intl.DateTimeFormat('en-US', options).format(date); }
  catch { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date); }
}

export function timeAgo(value, now = Date.now()) {
  const date = parseStoredDate(value);
  if (!date) return '';
  const minutes = Math.floor(Math.max(0, now - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function parseLinksJson(json) {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Any stored URL going into an href: http and https only. */
export function safeHref(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch {
    return '#';
  }
}

/** Split message text into plain parts and http(s) links. Everything else
    stays escaped text when rendered. */
export function messageLinks(body) {
  const text = String(body || '');
  const parts = [];
  let end = 0;
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s<>"()]+)\)|(https?:\/\/[^\s<>"[\]]+)/g;
  for (const match of text.matchAll(pattern)) {
    parts.push({ text: text.slice(end, match.index) });
    const raw = match[2] || match[3];
    const url = raw.replace(/[.,;!?)]+$/, '');
    parts.push({ text: match[1] || url, href: url });
    if (!match[2] && raw.length > url.length) parts.push({ text: raw.slice(url.length) });
    end = match.index + match[0].length;
  }
  parts.push({ text: text.slice(end) });
  return parts.filter((part) => part.text);
}

// Threads show this many newest messages; older ones fold behind one
// "Show earlier messages" control once a thread has two more than this.
export const THREAD_VISIBLE = 6;
