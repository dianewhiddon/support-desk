# Setup

You need a Cloudflare account, a Resend account, a domain on Cloudflare DNS, and Node 22 or newer.

## 1. Fork and run it locally

Fork this repository to your own GitHub account (keep it private), then:

```bash
git clone https://github.com/YOUR_GITHUB/support-desk-starter.git
cd support-desk-starter
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run db:seed
npm run dev
```

Open http://localhost:4321 and sign in as `sarah@example.com` (a seeded test client) or as the `ADMIN_EMAILS` address in `wrangler.jsonc`. Without a Resend key, no email goes out and the sign-in link prints in your terminal instead.

## 2. Make it yours

Edit the `vars` block in `wrangler.jsonc`:

| Setting | What it does |
|---|---|
| `BUSINESS_NAME` | Header, page titles and emails |
| `OWNER_NAME` | The name clients see: "With Kyle", "Kyle replied" |
| `OWNER_EMAIL` | Where new requests and client replies are emailed |
| `ADMIN_EMAILS` | Comma-separated addresses that sign in to the admin queue |
| `EMAIL_FROM` | Sender, on a domain verified in Resend |
| `EMAIL_NO_REPLY` | Reply-to on client notifications |
| `DEFAULT_TIME_ZONE` | Used for any client without their own time zone |
| `TICKET_PREFIX` | Request references, such as `SUP-2026-0001` |
| `TURNSTILE_SITE_KEY` | Optional bot check on the sign-in form |

Colors live as tokens at the top of `src/styles/desk.css`, with a dark-mode set below them. Email colors are at the top of `src/lib/email-layout.js`.

## 3. Create the Cloudflare resources

```bash
npx wrangler d1 create support-desk
npx wrangler r2 bucket create support-desk-uploads
```

Paste the D1 `database_id` into `wrangler.jsonc`, then create the tables in production:

```bash
npx wrangler d1 migrations apply DB --remote
```

Set your domain in `routes` (for example `support.yourstudio.com`).

## 4. Connect email

`EMAIL_FROM` has to be on a domain verified in Resend.

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_WEBHOOK_SECRET
```

The webhook secret comes from a Resend webhook at `https://YOUR_DESK_DOMAIN/api/webhooks/resend` subscribed to sent, delivered, delivery delayed, bounced, complained and failed. It's what turns "Accepted" into "Delivered" or "Bounced" on each request.

## 5. Turn on AI reply drafts

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Drafts are written when you click **Draft with AI** in the reply editor. `src/ai/reply-voice.txt` is added to every draft prompt; what ships there is a placeholder. **Client notes for AI drafts** on each client's page feed every draft for that client, and the drafts are only as specific as those notes.

Drafts use `claude-opus-5-5` at low effort; set `AI_MODEL` to change it, or `AI_DRAFTS` to `off` to pause drafting. Each draft is one short API call, billed to your Anthropic account.

## 6. Turn on the agent API (optional)

A random token of 32 or more characters:

```bash
npx wrangler secret put AGENT_TOKEN
```

The API itself is in [AUTO-FIX-GUIDE.md](AUTO-FIX-GUIDE.md).

## 7. Deploy

Workers Builds from your fork's `main`: build command `npm run build`, deploy command `npx wrangler deploy`.

## 8. Clients

Clients sign in with the email you add under **Clients**. Adding one sends nothing. With two or more active websites on a client, the request form asks which one.

## Optional: Turnstile

Create a Turnstile widget in Cloudflare for your desk domain, put the site key in `TURNSTILE_SITE_KEY`, and store the secret:

```bash
npx wrangler secret put TURNSTILE_SECRET
```

## Changing the database later

New numbered files in `migrations/`; `0001_init.sql` stays as shipped once it's deployed. D1 migrations never run on deploy, so apply them (`npx wrangler d1 migrations apply DB --remote`) before releasing code that depends on them.
