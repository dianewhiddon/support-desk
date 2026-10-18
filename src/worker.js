import { handle } from '@astrojs/cloudflare/handler';
import { boundedRequest, BodyTooLarge, privateResponse } from './lib/http-security.js';

export default {
  async fetch(request, env, ctx) {
    try {
      return privateResponse(await handle(await boundedRequest(request), env, ctx));
    } catch (error) {
      if (error instanceof BodyTooLarge)
        return privateResponse(new Response('Request too large.', { status: 413 }));
      const receipt = crypto.randomUUID();
      console.error(JSON.stringify({ event: 'request_failed', receipt }));
      return privateResponse(
        new Response(`Something went wrong. Try again. Reference: ${receipt}`, { status: 500 }),
      );
    }
  },
};
