/* Files attached to your reply. They stay private (role reply_draft) until
   the reply is sent, when the send batch publishes them onto the message.
   Removing a file leaves a private tombstone (reply_removed), so a retried
   upload with the same key is recognised instead of attached twice. */
import { getDraftById, openDraftForTicket, isClosed } from './db.js';

export const MAX_REPLY_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_REPLY_FILES = 6;
export const MAX_REPLY_TOTAL_BYTES = 45 * 1024 * 1024;

const OFFICE = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const TYPES = {
  ...OFFICE, pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', txt: 'text/plain', md: 'text/markdown',
};
const OFFICE_MAIN_PART = { pptx: 'ppt/presentation.xml', docx: 'word/document.xml', xlsx: 'xl/workbook.xml' };

const fail = (error, status = 409) => ({ ok: false, status, error });
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Read an Office file's ZIP directory without inflating it. The package must
    contain its application's main part and no macro project. */
function officeEntries(bytes) {
  const entries = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes[i] !== 80 || bytes[i + 1] !== 75 || bytes[i + 2] !== 1 || bytes[i + 3] !== 2) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset + i);
    const nameLength = view.getUint16(28, true);
    const extra = view.getUint16(30, true);
    const comment = view.getUint16(32, true);
    if (i + 46 + nameLength + extra + comment > bytes.length) return null;
    entries.push(new TextDecoder().decode(bytes.slice(i + 46, i + 46 + nameLength)));
    i += 45 + nameLength + extra + comment;
  }
  return entries;
}

export async function validateReplyFile(file) {
  if (!file?.size || typeof file.arrayBuffer !== 'function') return fail('Choose a file that is not empty.', 400);
  if (file.size > MAX_REPLY_FILE_BYTES) return fail('Each file must be 15 MB or smaller.', 400);
  const name = String(file.name || '');
  if (!name || name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(name) || name === '.' || name === '..') {
    return fail('Use a filename without slashes or control characters, up to 180 characters.', 400);
  }
  const extension = name.split('.').at(-1).toLowerCase();
  const contentType = TYPES[extension];
  if (!contentType) return fail('Choose a PowerPoint, Word, Excel, PDF, PNG, JPEG, WebP or text file.', 400);
  const declared = String(file.type || '').toLowerCase().split(';')[0];
  if (declared && ![contentType, 'application/octet-stream', ...(extension === 'md' ? ['text/plain'] : [])].includes(declared)) {
    return fail('The file type does not match its filename.', 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  let valid;
  if (OFFICE[extension]) {
    const entries = officeEntries(bytes);
    if (!entries) return fail('This Office file is damaged.', 400);
    valid = ascii(0, 4) === 'PK\x03\x04' && entries.includes('[Content_Types].xml')
      && entries.includes(OFFICE_MAIN_PART[extension]) && !entries.some((entry) => /vbaProject\.bin$/i.test(entry));
  } else if (extension === 'pdf') valid = ascii(0, 5) === '%PDF-';
  else if (extension === 'png') valid = bytes[0] === 137 && ascii(1, 3) === 'PNG';
  else if (extension === 'jpg' || extension === 'jpeg') valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  else if (extension === 'webp') valid = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  else valid = !bytes.includes(0);
  if (!valid) return fail('The file contents do not match a supported file type.', 400);
  return { ok: true, bytes, filename: name, contentType, size: file.size, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)) };
}

export async function listReplyFiles(db, ticketId, draftId) {
  if (!draftId) return [];
  return (await db.prepare(`SELECT id, filename, content_type, size FROM ticket_attachments
    WHERE ticket_id = ? AND role = 'reply_draft' AND json_extract(metadata_json, '$.draft_id') = ? ORDER BY id`)
    .bind(ticketId, draftId).all()).results;
}

export async function replyDraftState(db, ticket) {
  const draft = await openDraftForTicket(db, ticket.id);
  return {
    ok: true,
    ticket_revision: ticket.revision,
    draft: draft ? { id: draft.id, revision: draft.revision, body: draft.body || '', status: draft.status, source: draft.source } : null,
    attachments: await listReplyFiles(db, ticket.id, draft?.id),
  };
}

async function currentDraft(db, ticket, { draftId, draftRevision, ticketRevision }) {
  const draft = await getDraftById(db, Number(draftId));
  if (!draft || draft.ticket_id !== ticket.id || draft.client_id !== ticket.client_id || draft.status !== 'ready'
    || draft.revision !== Number(draftRevision) || ticket.revision !== Number(ticketRevision) || isClosed(ticket)) return null;
  return draft;
}

const DRAFT_GUARD = `id = ? AND revision = ? AND status = 'ready' AND ticket_id = ? AND client_id = ?
  AND EXISTS (SELECT 1 FROM tickets WHERE id = ? AND revision = ? AND status NOT IN ('done','closed'))`;
const draftGuardValues = (ticket, draft) => [draft.id, draft.revision, ticket.id, ticket.client_id, ticket.id, ticket.revision];

export async function addReplyFile(env, ticket, input, file) {
  const key = String(input.idempotencyKey || '');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) return fail('Use an upload key of 8 to 100 letters, numbers, underscores or hyphens.', 400);
  const valid = await validateReplyFile(file);
  if (!valid.ok) return valid;
  const existing = await env.DB.prepare(`SELECT * FROM ticket_attachments WHERE ticket_id = ?
    AND role IN ('reply_draft','reply_removed') AND json_extract(metadata_json, '$.upload_key') = ?`).bind(ticket.id, key).first();
  if (existing) {
    const metadata = JSON.parse(existing.metadata_json);
    if (metadata.sha256 !== valid.sha256 || existing.filename !== valid.filename || metadata.draft_id !== Number(input.draftId)) {
      return fail('This upload key already belongs to a different file.');
    }
    return { ...await replyDraftState(env.DB, ticket), replayed: true };
  }
  const draft = await currentDraft(env.DB, ticket, input);
  if (!draft) return fail('The request or draft changed. Reload before attaching files.');
  const files = await listReplyFiles(env.DB, ticket.id, draft.id);
  if (files.length >= MAX_REPLY_FILES || files.reduce((total, item) => total + item.size, 0) + valid.size > MAX_REPLY_TOTAL_BYTES) {
    return fail('A reply can carry up to 6 files, 45 MB in total.', 400);
  }
  const r2Key = `tickets/${ticket.ref}/reply/${draft.id}/${key}-${valid.sha256}`;
  await env.UPLOADS.put(r2Key, valid.bytes, { httpMetadata: { contentType: valid.contentType } });
  const metadata = JSON.stringify({ draft_id: draft.id, upload_key: key, sha256: valid.sha256 });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_attachments (ticket_id, r2_key, filename, content_type, size, role, metadata_json)
      SELECT ?, ?, ?, ?, ?, 'reply_draft', ? WHERE EXISTS (SELECT 1 FROM reply_drafts WHERE ${DRAFT_GUARD})
      AND NOT EXISTS (SELECT 1 FROM ticket_attachments WHERE ticket_id = ? AND json_extract(metadata_json, '$.upload_key') = ?)`)
      .bind(ticket.id, r2Key, valid.filename, valid.contentType, valid.size, metadata, ...draftGuardValues(ticket, draft), ticket.id, key),
    env.DB.prepare("UPDATE reply_drafts SET revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND changes() = 1").bind(draft.id),
  ]);
  const stored = await env.DB.prepare('SELECT id FROM ticket_attachments WHERE ticket_id = ? AND r2_key = ?').bind(ticket.id, r2Key).first();
  if (!stored) {
    await env.UPLOADS.delete(r2Key);
    return fail('The draft changed during the upload, so the file was not attached. Reload and try again.');
  }
  return { ...await replyDraftState(env.DB, ticket), attachment_id: stored.id };
}

export async function removeReplyFile(env, ticket, input, id) {
  const file = await env.DB.prepare(`SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?
    AND role IN ('reply_draft','reply_removed') AND json_extract(metadata_json, '$.draft_id') = ?`)
    .bind(Number(id), ticket.id, Number(input.draftId)).first();
  if (!file) return fail('That draft file was not found.', 404);
  if (file.role === 'reply_removed') return { ...await replyDraftState(env.DB, ticket), replayed: true };
  const draft = await currentDraft(env.DB, ticket, input);
  if (!draft) return fail('The request or draft changed. Reload before removing files.');
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE ticket_attachments SET role = 'reply_removed' WHERE id = ? AND role = 'reply_draft'
      AND EXISTS (SELECT 1 FROM reply_drafts WHERE ${DRAFT_GUARD})`).bind(file.id, ...draftGuardValues(ticket, draft)),
    env.DB.prepare("UPDATE reply_drafts SET revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND changes() = 1").bind(draft.id),
  ]);
  if (!results[0].meta.changes) return fail('The draft changed, so the file was not removed. Reload and try again.');
  return replyDraftState(env.DB, ticket);
}
