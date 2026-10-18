/* Test doubles: an in-memory SQLite database shaped like Cloudflare D1, and
   an in-memory R2 bucket. The real migrations run against it. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function createEnv(t, vars = {}) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  const statement = (sql, values = []) => ({
    bind(...args) { return statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() {
      const result = sqlite.prepare(sql).run(...values);
      return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
  });
  const DB = {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const objects = new Map();
  const UPLOADS = {
    objects,
    async put(key, value) { objects.set(key, value); },
    async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
    async delete(key) { objects.delete(key); },
  };
  const env = {
    DB, UPLOADS,
    BUSINESS_NAME: 'Skynet Web Studio',
    OWNER_NAME: 'Kyle',
    OWNER_EMAIL: 'kyle@studio.test',
    ADMIN_EMAILS: 'kyle@studio.test',
    EMAIL_FROM: 'Skynet Web Studio <support@studio.test>',
    EMAIL_NO_REPLY: 'no-reply@studio.test',
    TICKET_PREFIX: 'SUP',
    ...vars,
  };
  return { env, sqlite };
}

export function seedClient(sqlite, { email = 'sarah@example.com', name = 'Sarah Connor', sites = 1 } = {}) {
  const { lastInsertRowid } = sqlite.prepare('INSERT INTO clients (email, name) VALUES (?, ?)').run(email, name);
  const id = Number(lastInsertRowid);
  for (let i = 0; i < sites; i += 1) sqlite.prepare('INSERT INTO sites (client_id, label, url) VALUES (?, ?, ?)').run(id, `Site ${i + 1}`, `https://site${i + 1}.example.com`);
  return sqlite.prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

/** A fake email sender that records what it was asked to send. */
export function recordingSender({ fail = false } = {}) {
  const sent = [];
  const send = async (env, payload) => {
    sent.push(payload);
    return fail ? { ok: false, status: 500, detail: 'provider down' } : { ok: true, providerMessageId: `msg_${sent.length}` };
  };
  return { sent, send };
}

export const pngFile = (name = 'photo.png') =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], name, { type: 'image/png' });
export const pdfFile = (name = 'notes.pdf') => new File([new TextEncoder().encode('%PDF-1.7\n%test')], name, { type: 'application/pdf' });
