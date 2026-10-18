# Architecture

Support Desk is one server-rendered Astro application. D1 is the source of truth; R2 contains private file bytes. Resend and optional Anthropic calls are adapters at the edge of the application. There is no client-side framework or separate API server.

| Area                                             | Owner                                            |
| ------------------------------------------------ | ------------------------------------------------ |
| Request limits, response headers, error receipts | `src/worker.js`, `src/lib/http-security.js`      |
| Session and role checks                          | `src/middleware.js`, `src/lib/auth.js`           |
| Database queries and atomic batches              | `src/lib/db.js`, `migrations/`                   |
| Client requests, replies and feedback            | `src/lib/requests.js`                            |
| Owner drafts, send and state transitions         | `src/lib/workflow.js`                            |
| Client and reply file validation                 | `uploads.js`, `reply-files.js`, `office.js`      |
| Private downloads                                | `attachments.js` and guarded file routes         |
| Notification payloads and delivery               | `email.js`, `email-layout.js`, `ticket-email.js` |
| Optional AI drafting                             | `ai-drafts.js`, `src/ai/reply-voice.txt`         |
| Trusted agent API                                | `agent.js`, `src/pages/api/agent/`               |
| Shared UI                                        | `src/styles/desk.css`, layouts and components    |

## State and consistency

Requests move through `new`, `open`, `waiting`, `done` and `closed`. Client replies reopen a request. `done` means resolved; `closed` means dismissed as a duplicate or no longer needed. A numeric revision guards owner state changes.

Each request has at most one editable draft, enforced by a partial unique index. Sending checks the exact draft ID, revision and text, inserts the message, publishes its draft files, consumes the draft and changes the ticket status in one D1 batch. The notification is saved in that batch. A reused message key cannot create another message.

New client requests and replies also save notification payloads in their write batch. Background delivery happens after the response where the runtime supports it. Failed or interrupted delivery leaves a row the owner can inspect and retry. There is no hidden scheduler or unlimited background retry loop.

R2 and D1 do not share a transaction. Files upload first and failed database writes attempt cleanup. A process termination between storage and database writes can still leave an orphan; retention and backup procedures must account for that. Reply-removal tombstones stay private so retries remain identifiable.

## Testing boundaries

Unit tests use Node's built-in test runner and SQLite with the actual migrations, foreign keys enabled, transactional D1-shaped batches, and R2/email/model doubles. They prove application behavior under those doubles. They do not prove provider availability, real email delivery, Cloudflare configuration or browser microphone permissions.

The read-only demo runs the built application in Wrangler's local runtime with fictional data. Its loopback-only proxy supplies fixture sessions outside the app; there is no production authentication bypass. Working-form checks use normal local sign-in.

## Tradeoffs

The code favors a small self-hosted desk: server rendering, SQL constraints, explicit functions and no event framework. It does not include distributed background jobs, inbound-email threading or server-verifiable chat approval. Those would require additional state, operational responsibilities and tests.
