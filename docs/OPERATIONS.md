# Operations

## Updates

Back up D1 and R2 before updating. Read the release notes and migration list. Test the release against a separate local or staging database, run `npm ci && npm run verify`, commit your configured version and push main. Verify the exact successful Workers Build and run the acceptance path in [SETUP.md](SETUP.md).

Apply additive database migrations before activating code that depends on them. Never rewrite an applied migration. Roll back code only while its database contract remains compatible; a code rollback does not undo data changes.

## Email recovery

The conversation is the record of a reply. An email is a notification, not the reply itself. If email fails, do not create a second reply.

Open the request's **Email notifications** section. Retry uses the original stored payload and idempotency key. An interrupted send waits ten minutes before another worker can claim it. Accepted, delivered, bounced or complained messages are not blindly resent. The webhook verifies a signature before applying provider status.

Resend retains [idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys). The desk refuses another unconfirmed attempt after 23 hours from creation. Check Resend using the recorded key, recipient and subject. If it was delivered, leave the conversation alone. If it was not, contact the client through your approved channel or send a new notification only after confirming the outcome. There is no automatic scheduled retry job.

Provider receipts are saved and reconciled even when they arrive before the send response. Inspect Resend when a notification remains Accepted unexpectedly. Provider delivery remains authoritative; Accepted does not mean Delivered.

## Backups and restore

Use Cloudflare's current [D1 backup and Time Travel guidance](https://developers.cloudflare.com/d1/reference/time-travel/) for your plan and retention window. Keep periodic database exports in a protected location. Back up **all private R2 objects and their keys** separately; a D1 backup contains metadata, not file bytes.

Test restoration to an isolated database and bucket before trusting the process. Point a separate staging Worker at the restored resources, disable provider keys, verify request/message counts and sample attachment downloads, and keep it inaccessible to clients. Document your own recovery point and recovery time targets. This repository does not provision backups for you.

## Access and retention

Review `ADMIN_EMAILS` and client activation regularly. Replace `AGENT_TOKEN` to revoke agent access. Rotate a leaked provider secret in its own provider, then update the Worker secret. Never put replacement secrets in a ticket.

Keep retention rules appropriate to the information your clients submit. No automatic deletion policy is shipped. Deleting a client and its data requires a coordinated export/deletion of related D1 records, R2 objects, provider records and backups; disabling a client only revokes access. Perform destructive retention work through a reviewed administrative procedure with a backup.

Removed draft files remain private tombstones. A process termination between an R2 upload and a D1 write can leave an unreferenced object. Reconcile bucket keys against `ticket_attachments.r2_key` in a read-only inventory before planning cleanup; never delete from an approximate match.

## Troubleshooting

| Symptom                      | Check                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No sign-in email             | Correct admin/client address, active client, Resend key/domain, login limits, optional Turnstile configuration |
| Session opens the wrong role | Admin allowlist takes precedence over a client record with the same email                                      |
| Forbidden on a form          | Exact browser Origin, HTTPS domain and reverse-proxy origin handling                                           |
| Draft changed                | Another tab or agent saved a newer revision; keep your text, reload the saved draft and compare                |
| Upload refused               | Size/count, extension/content match, filename, Office structure and unsupported macro/embedded binary content  |
| AI drafting unavailable      | `AI_DRAFTS=on`, API key, account/model access; regular replies still work                                      |
| 413 Request too large        | Reduce attachments; total file allowance is 45 MB, request envelope 46 MB                                      |
| Internal error reference     | Use the opaque receipt in Worker logs; never paste client content into a public issue                          |

Production logs do not print sign-in links when email is unconfigured. Development email previews are local only; do not expose a development server publicly.
