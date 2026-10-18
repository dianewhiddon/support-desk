import type { Client } from './lib/models';
declare global {
  // Scope Worker binding types so HTMLRewriter's Element cannot replace the browser DOM.
  type D1Database = import('@cloudflare/workers-types').D1Database;
  type R2Bucket = import('@cloudflare/workers-types').R2Bucket;
  type Fetcher = import('@cloudflare/workers-types').Fetcher;
  type ExecutionContext = import('@cloudflare/workers-types').ExecutionContext;
  namespace App {
    interface Locals {
      admin?: { email: string };
      client?: Client;
      cfContext?: ExecutionContext;
    }
  }
}
export {};
