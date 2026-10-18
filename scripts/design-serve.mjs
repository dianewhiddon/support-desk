/* Layout-test server: runs the built app (npm run build first) with wrangler's
   local runtime against a throwaway database of fixture data, behind a small
   proxy on HOST:PORT that signs requests in as a fixture client or admin.
   The sign-in happens here, outside the app, so production code has no test
   bypass. It also renders the client notification email at /__design/email.
   Usage: HOST=127.0.0.1 PORT=8899 npm run design:serve */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderNotificationEmail } from '../src/lib/email-layout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8899);
const state = path.join(os.tmpdir(), 'support-desk-design-state');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const quiet = { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } };

fs.rmSync(state, { recursive: true, force: true });
for (const args of [
  ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state],
  ['d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', 'scripts/design-fixtures.sql'],
]) {
  const result = spawnSync(process.execPath, [wrangler, ...args], quiet);
  if (result.status !== 0) { console.error(result.stderr || result.stdout); process.exit(1); }
}

const freePort = await new Promise((resolve) => {
  const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port: p } = probe.address(); probe.close(() => resolve(p)); });
});
const app = spawn(process.execPath, [wrangler, 'dev', '--ip', '127.0.0.1', '--port', String(freePort), '--persist-to', state, '--show-interactive-dev-session=false',
  // Shows the AI draft controls. The page never calls Anthropic unless a test clicks Draft with AI, which none does.
  '--var', 'ANTHROPIC_API_KEY:layout-test-placeholder'], { ...quiet, stdio: 'ignore' });
const stop = () => { if (app.exitCode === null) app.kill(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
app.on('exit', () => process.exit(1));

const ADMIN = ['/admin', '/api/admin'];
const CLIENT = ['/dashboard', '/tickets', '/api/tickets', '/api/files', '/files'];
const under = (pathname, prefixes) => prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const email = renderNotificationEmail({
  businessName: 'Your Business', firstName: 'Sarah', heading: 'Kyle replied to your request.',
  body: 'Open SUP-2026-0001 to read the message and reply there.', actionLabel: 'Read and reply',
  actionUrl: 'http://127.0.0.1/tickets/SUP-2026-0001', files: [{ name: 'hero-options.pdf', url: 'http://127.0.0.1/files/2' }],
});

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/__design/email') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(email.html);
    return;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${freePort}` };
  delete headers.cookie;
  if (under(url.pathname, ADMIN)) headers.cookie = 'sd_session=design-admin-session';
  else if (under(url.pathname, CLIENT)) headers.cookie = 'sd_session=design-client-session';
  const upstream = http.request({ host: '127.0.0.1', port: freePort, method: req.method, path: req.url, headers }, (reply) => {
    const location = reply.headers.location?.replace(`http://127.0.0.1:${freePort}`, `http://${host}:${port}`);
    res.writeHead(reply.statusCode, { ...reply.headers, ...(location ? { location } : {}) });
    reply.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(503); res.end('Starting'); });
  req.pipe(upstream);
}).listen(port, host);
