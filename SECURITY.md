# Security and privacy

## Report a vulnerability

Use GitHub's **Security → Report a vulnerability** if available. Otherwise contact **diane@swayrisecreative.com** with the affected version, reproduction steps using fictional data, and expected impact. Do not include live credentials, client records or attachments. Please allow a fix before public disclosure. No response-time guarantee is offered.

## Trust boundaries

- Administrators are the addresses explicitly listed in `ADMIN_EMAILS`. Removing one revokes its sessions on the next request. Inactive clients cannot sign in or use an existing session.
- Session credentials and one-use sign-in tokens are SHA-256 hashed in D1. Cookies are HttpOnly, SameSite=Lax and Secure in production. Sign-out uses POST. Browser writes require an exact Origin.
- Client routes check ownership. Unsent reply attachments and private notes are excluded from the client conversation and downloads. R2 must remain private.
- Dynamic responses use `no-store`, `no-referrer`, `nosniff` and anti-framing headers. File responses additionally have a sandbox CSP. The app uses inline scripts and does not claim a restrictive script CSP.
- Request bodies, message lengths and file counts/sizes are bounded. Login attempts are limited by address and IP in atomic ten-minute windows. Optional Turnstile adds bot verification.
- An agent token is a full-desk credential, including sending and status changes. It is disabled when absent or shorter than 32 characters. Give it only to an agent you trust; rotate it by replacing the Worker secret. Human approval in chat is an operating rule, **not a server-verified approval**. Exact draft/revision checks prevent stale or changed text, not malicious authorized agents.

## Data and providers

D1 holds client contact details, requests, messages, drafts, client notes, delivery records and audit events. Private R2 holds attachments. Resend receives notification payloads; owner notices include request text, while client reply notifications link back to the desk. Cloudflare runs the app and stores operational logs.

AI is optional and off by default. Enabling it sends the request, recent client-visible conversation, client contact/context fields, and **Client notes for AI drafts** to Anthropic. Private conversation notes and attachment contents are excluded. The model has no tools. Prompt-injection defenses reduce risk but do not guarantee safe or accurate output. Inspect every draft before sending.

Client forms may retain unsent text in browser storage. Use individual browser profiles on shared machines. Configure your own privacy notice, retention period, provider agreements and access procedures before inviting clients.

## Limits

File validation checks supported signatures and Office archive structure, rejects macro/ActiveX/binary Office parts and obvious path tricks, and forces documents to download. It does not detect every malicious document or inspect external relationships in Office/PDF files. Use endpoint protection and consider a dedicated scanning service for higher-risk workloads.

The application is for one business with trusted administrators. It is not a regulated-data compliance package, independent security certification, multi-tenant isolation system or unlimited-volume ticket service. Queue/history views currently load all matching records; benchmark your expected volume before deployment.

Email retries use stored payloads and provider idempotency keys. After an unconfirmed attempt ages beyond 23 hours, automatic resend is refused because Resend retains keys for 24 hours. Confirm the outcome in Resend before making a new notification. See [operations](docs/OPERATIONS.md).
