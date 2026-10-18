import { tokenHash } from './token-hash.js';

/** Fixed ten-minute windows, at most five attempts per address and per IP.
 * Conditional upserts make parallel submissions share the same allowance. */
export async function allowLogin(db, email, ip, now = Date.now()) {
  const window = Math.floor(now / 600000);
  const expires = (window + 2) * 600000;
  const keys = [await tokenHash(`email/${email.trim().toLowerCase()}/${window}`)];
  if (ip) keys.push(await tokenHash(`ip/${ip}/${window}`));
  const results = await db.batch(
    keys.map((key) =>
      db
        .prepare(
          `INSERT INTO login_limits (key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 5`,
        )
        .bind(key, expires),
    ),
  );
  await db.prepare('DELETE FROM login_limits WHERE expires_at < ?').bind(now).run();
  return results.every((result) => result.meta.changes === 1);
}
