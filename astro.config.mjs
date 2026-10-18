// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  // No Astro image pipeline: uploads go straight to R2, so no IMAGES binding.
  adapter: cloudflare({ imageService: 'passthrough' }),
  // The app keeps its own cookie sessions in D1. An explicit driver stops the
  // adapter from adding a SESSION KV binding to every deploy.
  session: { driver: { entrypoint: 'unstorage/drivers/memory' } },
});
