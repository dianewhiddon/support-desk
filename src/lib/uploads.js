/* Client uploads. Every file is checked by its first bytes, not only its
   name or declared type, before anything reaches R2. */
import { validOffice } from './office.js';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_FILES = 6;
export const MAX_TOTAL_BYTES = 45 * 1024 * 1024;

const MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'application/pdf',
]);

const DOCUMENT_TYPES = new Map([
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.md', 'text/markdown'],
  ['.txt', 'text/plain'],
]);

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.slice(start, start + length));
const declaredType = (file) =>
  String(file.type || '')
    .toLowerCase()
    .split(';', 1)[0]
    .trim();

async function detectedMediaType(file) {
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 4))) return 'image/avif';
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(bytes, 0, 4) === 'OggS') return 'audio/ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(bytes, 4, 4) === 'ftyp') return 'audio/mp4';
  return null;
}

async function validateDocument(file) {
  const name = String(file.name).toLowerCase();
  const extension = [...DOCUMENT_TYPES.keys()].find((item) => name.endsWith(item));
  const expected = DOCUMENT_TYPES.get(extension);
  const declared = declaredType(file);
  if (extension === '.docx') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (
      !validOffice(bytes, 'docx') ||
      (declared && ![expected, 'application/octet-stream'].includes(declared))
    )
      return { ok: false, reason: 'signature' };
  } else {
    if (declared && ![expected, 'text/plain', 'application/octet-stream'].includes(declared))
      return { ok: false, reason: 'type' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.includes(0)) return { ok: false, reason: 'signature' };
  }
  return { ok: true, contentType: expected };
}

export async function validateTicketFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.name || !file.size)
    return { ok: false, reason: 'empty' };
  if (file.name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(file.name)) return { ok: false, reason: 'type' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'size' };
  if (/\.(docx|md|txt)$/i.test(file.name)) return validateDocument(file);
  const declared = declaredType(file);
  if (!MEDIA_TYPES.has(declared)) return { ok: false, reason: 'type' };
  const detected = await detectedMediaType(file);
  if (!detected) return { ok: false, reason: 'signature' };
  const compatible =
    declared === detected ||
    (declared === 'audio/x-wav' && detected === 'audio/wav') ||
    (['audio/x-m4a', 'audio/aac'].includes(declared) && detected === 'audio/mp4');
  return compatible ? { ok: true, contentType: detected } : { ok: false, reason: 'signature' };
}

/** Validate a whole submission. Returns { ok, reason }. */
export async function validateTicketFiles(files) {
  if (files.length > MAX_FILES) return { ok: false, reason: 'too_many' };
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES)
    return { ok: false, reason: 'too_large' };
  if (files.some((file) => file.size > MAX_FILE_BYTES)) return { ok: false, reason: 'too_large' };
  const results = await Promise.all(files.map(validateTicketFile));
  return results.every((result) => result.ok) ? { ok: true, results } : { ok: false, reason: 'attachments' };
}

const safeName = (name) =>
  String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || 'file';

/** Store one validated file under tickets/<ref>/ in R2. */
export async function storeTicketFile(bucket, ref, file) {
  const valid = await validateTicketFile(file);
  if (!valid.ok) return valid;
  const key = `tickets/${ref}/${crypto.randomUUID()}-${safeName(file.name)}`;
  await bucket.put(key, file, { httpMetadata: { contentType: valid.contentType } });
  return { ok: true, key, filename: file.name, contentType: valid.contentType, size: file.size };
}

/** Store every file or none: a failure deletes what was already stored. */
export async function storeTicketFiles(bucket, ref, files) {
  const stored = [];
  try {
    for (const file of files) {
      const result = await storeTicketFile(bucket, ref, file);
      if (!result.ok) throw new Error(result.reason);
      stored.push(result);
    }
    return { ok: true, stored };
  } catch {
    await deleteStored(bucket, stored);
    return { ok: false, stored: [] };
  }
}

export async function deleteStored(bucket, stored) {
  await Promise.all(stored.map((item) => bucket.delete(item.key)));
}

export function formFiles(form, name = 'files') {
  return form.getAll(name).filter((file) => file && typeof file.arrayBuffer === 'function' && file.name);
}

export function parseLinks(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 20);
}
