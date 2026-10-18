# Setup

## Local development

Install Node 24 LTS (minimum 22.12), npm and Git. Clone your fork or extract the release source archive, then open that directory in a terminal.

```sh
npm ci
```

Copy `.dev.vars.example` to `.dev.vars`. On macOS/Linux use `cp .dev.vars.example .dev.vars`; on PowerShell use `Copy-Item .dev.vars.example .dev.vars`. Leave keys empty for local work. The file is ignored by Git.

```sh
npm run db:local
npm run db:seed
npm run dev
```

Open **http://localhost:4321/login**. Enter `sarah@example.com` for the fictional client or `you@YOUR_DOMAIN.com` for the starter admin. Without a Resend key, the development server prints the sign-in email locally. Open its link, then choose **Continue**. The production build never prints these links.

Local records and uploads stay in `.wrangler/`. The seed script is for local development only. Do not seed a real desk or copy this directory into production. Use `npm run demo` after a build for a separate read-only fictional preview.

## Configure your business

Set these public configuration values in `wrangler.jsonc` before hosting:

| Value                         | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `name`                        | Unique Worker name in your Cloudflare account            |
| `routes`                      | Your support domain, such as `support.example.com`       |
| `DB.database_id`              | Your new D1 database ID                                  |
| `UPLOADS.bucket_name`         | Your private R2 bucket name                              |
| `BUSINESS_NAME`, `OWNER_NAME` | Names shown in pages and notifications                   |
| `OWNER_EMAIL`                 | Recipient of new-request and client-reply notices        |
| `ADMIN_EMAILS`                | Comma-separated admin addresses; these grant full access |
| `EMAIL_FROM`                  | Sender on your Resend-verified domain                    |
| `EMAIL_NO_REPLY`              | Reply-to for notifications; replies belong on the desk   |
| `DEFAULT_TIME_ZONE`           | IANA name, for example `America/Chicago`                 |
| `TICKET_PREFIX`               | Short alphanumeric reference prefix                      |
| `TURNSTILE_SITE_KEY`          | Optional public key for your domain                      |
| `AI_DRAFTS`                   | `off` by default; `on` enables configured AI drafts      |
| `AI_MODEL`                    | Optional model override; default `claude-haiku-5-5`      |

Gold/neutral colors are tokens in `src/styles/desk.css`; email colors are in `src/lib/email-layout.js`. The app contains no fixed business logo. Set your own first-admin email before deployment; clients cannot grant themselves administrator access.

## Create an isolated deployment

Use your own Cloudflare, GitHub and Resend accounts. Create a private R2 bucket and a new D1 database in Cloudflare; do not enable public R2 access. Put their binding values in the config, commit and push your fork's `main`.

Apply the committed migrations to that exact database through your authorized infrastructure workflow. If using Wrangler in your own environment, the command is:

```sh
npx wrangler d1 migrations apply DB --remote
```

Check the selected account, database ID and migration list before confirming. Never run the local seed against this database. Migrations and code deployment are separate actions.

Connect the repository's `main` branch to **Cloudflare Workers Builds**. Configure the build command as `npm ci && npm run verify` and the platform deploy command as `npx wrangler deploy`. That deploy command belongs in Workers Builds; normal releases are commits pushed to main. Confirm the resulting build uses the exact commit you pushed.

Before inviting clients, configure secrets in the Worker settings and verify email. Follow [Cloudflare's Git integration documentation](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/) for the current account-connection flow.

## Email

Verify your sender domain in Resend and configure `RESEND_API_KEY` as a Worker secret. Create a Resend webhook at `https://YOUR_DESK_DOMAIN/api/webhooks/resend` for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained` and `email.failed`. Store its signing secret as `RESEND_WEBHOOK_SECRET`.

Keep secrets out of `wrangler.jsonc`, Git, screenshots and issue reports. Production without a Resend key cannot deliver sign-in links. The same generic sign-in acknowledgement is shown whether an address exists or not; inspect your provider/configuration if a known admin link does not arrive.

## Optional services

**Turnstile:** create a widget for your support domain, set its public site key and store `TURNSTILE_SECRET`. A configured site key without a working secret fails closed. Test an actual login before inviting clients.

**AI drafts:** store `ANTHROPIC_API_KEY`, set `AI_DRAFTS` to `on`, edit `src/ai/reply-voice.txt`, and add only appropriate context to **Client notes for AI drafts**. Read [SECURITY.md](../SECURITY.md) for exactly what goes to Anthropic. Each click incurs your provider's usage charges. No AI service is needed for normal support work.

**Agent API:** generate a random token, for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, and store it as `AGENT_TOKEN`. Keep it in your agent's secret environment, never a skill or mapping file. This grants full access to the desk. Read [AGENTS.md](AGENTS.md) before enabling it.

## Acceptance before inviting clients

Use a test client you control and a small, harmless test attachment:

1. Confirm the exact Workers Builds commit and HTTPS domain.
2. Receive and consume an admin link; confirm a reused link fails.
3. Add your test client and sign in separately. Submit a request with a file.
4. Confirm the client receipt and owner notice arrive. Read the file from each authorized view.
5. Save a private note and a reply draft. Confirm neither appears in the client view.
6. Send the reply and resolve. Confirm the client sees it and receives a notification; verify the delivery webhook changes the status.
7. Reopen from client feedback. Disable the test client and confirm its session loses access.
8. Check both themes on desktop and phone. Configure backups and your privacy/retention notice.

Adding a client sends no invitation. Share your desk URL only after this check.
