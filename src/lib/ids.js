/* Token and reference generation. */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newToken(length = 24) {
  // 252 is the largest multiple of 36 below 256, so every character is equally likely.
  const out = [];
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < 252 && out.length < length) out.push(ALPHABET[byte % 36]);
    }
  }
  return out.join('');
}

export function newSessionId() {
  return newToken(40);
}

/** Next ticket reference, PREFIX-YYYY-NNNN, numbered per calendar year.
    One atomic upsert on the counters table, so concurrent requests never
    share a number. */
export async function nextTicketRef(db, prefix = 'SUP') {
  const year = new Date().getFullYear();
  const row = await db.prepare(
    'INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value'
  ).bind(`ticket_ref_${year}`).first();
  return `${prefix}-${year}-${String(row.value).padStart(4, '0')}`;
}
