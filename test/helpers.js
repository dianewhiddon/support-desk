/* Test doubles: an in-memory SQLite database shaped like Cloudflare D1, and
   an in-memory R2 bucket. The real migrations run against it. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function createEnv(t, vars = {}) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  const statement = (sql, values = []) => ({
    bind(...args) {
      return statement(sql, args);
    },
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    run() {
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
        // D1 serializes each batch as one transaction. Do not yield between statements.
        for (const item of statements) results.push(item.run());
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
    async put(key, value) {
      objects.set(key, value);
    },
    async get(key) {
      return objects.has(key) ? { body: objects.get(key) } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  const env = {
    DB,
    UPLOADS,
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
  const { lastInsertRowid } = sqlite
    .prepare('INSERT INTO clients (email, name) VALUES (?, ?)')
    .run(email, name);
  const id = Number(lastInsertRowid);
  for (let i = 0; i < sites; i += 1)
    sqlite
      .prepare('INSERT INTO sites (client_id, label, url) VALUES (?, ?, ?)')
      .run(id, `Site ${i + 1}`, `https://site${i + 1}.example.com`);
  return sqlite.prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

/** A fake email sender that records what it was asked to send. */
export function recordingSender({ fail = false } = {}) {
  const sent = [];
  const send = async (_env, payload) => {
    sent.push(payload);
    return fail
      ? { ok: false, status: 500, detail: 'provider down' }
      : { ok: true, providerMessageId: `msg_${sent.length}` };
  };
  return { sent, send };
}

export const pngFile = (name = 'photo.png') =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], name, {
    type: 'image/png',
  });
export const pdfFile = (name = 'notes.pdf') =>
  new File([new TextEncoder().encode('%PDF-1.7\n%test')], name, { type: 'application/pdf' });

/** Minimal, internally consistent stored ZIP package for structural validation. */
export function officeFile(names) {
  const local = [],
    central = [];
  let offset = 0;
  for (const name of names) {
    const text = new TextEncoder().encode(name);
    const head = new Uint8Array(30 + text.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(26, text.length, true);
    head.set(text, 30);
    const entry = new Uint8Array(46 + text.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(28, text.length, true);
    ev.setUint32(42, offset, true);
    entry.set(text, 46);
    local.push(head);
    central.push(entry);
    offset += head.length;
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, names.length, true);
  view.setUint16(10, names.length, true);
  view.setUint32(
    12,
    central.reduce((n, item) => n + item.length, 0),
    true,
  );
  view.setUint32(16, offset, true);
  return new File([...local, ...central, end], 'brief.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
