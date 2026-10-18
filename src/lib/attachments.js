/* Stream one private attachment after the route has established who is asking.
   Clients only get files on their own tickets, never private reply drafts and
   never files on a private note. Admin routes pass privileged: true. */

export async function attachmentResponse(env, id, { clientId = null, privileged = false } = {}) {
  if (!privileged && (!Number.isInteger(clientId) || clientId < 1)) return new Response('Forbidden', { status: 403 });
  const attachmentId = Number(id);
  if (!Number.isInteger(attachmentId) || attachmentId < 1) return new Response('Not found', { status: 404 });
  const file = await env.DB.prepare(`
    SELECT a.*, t.client_id AS owner_client_id, m.visibility AS message_visibility
    FROM ticket_attachments a JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN messages m ON m.id = a.message_id AND m.ticket_id = a.ticket_id
    WHERE a.id = ?
  `).bind(attachmentId).first();
  if (!file || file.role === 'reply_removed') return new Response('Not found', { status: 404 });
  if (!canClientRead(file, clientId) && !privileged) return new Response('Forbidden', { status: 403 });
  const object = await env.UPLOADS.get(file.r2_key);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, { headers: attachmentHeaders(file) });
}

export function canClientRead(file, clientId) {
  if (file.role === 'reply_draft' || file.role === 'reply_removed') return false;
  if (Number(file.owner_client_id) !== clientId) return false;
  return !file.message_id || file.message_visibility === 'client';
}

/** Images and audio may display inline; everything else downloads. The
    sandbox CSP stops an uploaded file from running script on this origin. */
export function attachmentHeaders(file) {
  const name = file.filename || 'file';
  const asciiName = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
  const unicode = /[^\x00-\x7F]/.test(name) && !/[\x00-\x1F\x7F]/.test(name)
    ? `; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
    : '';
  const inline = /^(image\/(jpeg|png|gif|webp|avif)|audio\/(mpeg|wav|ogg|webm|mp4))$/i.test(file.content_type || '')
    && !String(file.role || '').startsWith('reply_');
  return {
    'content-type': file.content_type || 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"${unicode}`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    'cross-origin-resource-policy': 'same-origin',
  };
}

export function attachmentHref(id, admin = false) {
  return `${admin ? '/api/admin/files' : '/api/files'}/${encodeURIComponent(id)}`;
}
