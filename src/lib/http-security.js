/** Browser writes require exact Origin; API routes authenticate bearer tokens or signatures. */
export function allowedOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const url = new URL(request.url);
  if (url.pathname === '/api/webhooks/resend' || url.pathname.startsWith('/api/agent/')) return true;
  return request.headers.get('origin') === url.origin;
}

export function privateResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
  // Preserve the stronger sandbox policy on file responses.
  if (!headers.has('content-security-policy'))
    headers.set(
      'content-security-policy',
      "base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    );
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export class BodyTooLarge extends Error {}

/** Bound bodies before the framework buffers multipart or JSON input. */
export async function boundedRequest(request) {
  if (!request.body) return request;
  const path = new URL(request.url).pathname;
  const uploads =
    path === '/api/tickets' ||
    /^\/api\/tickets\/[^/]+\/reply$/.test(path) ||
    /^\/api\/admin\/tickets\/[^/]+\/attachments$/.test(path);
  const limit = uploads ? 46 * 1024 * 1024 : 128 * 1024;
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new BodyTooLarge();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Request(request, { body: new Blob(chunks), duplex: 'half' });
}
