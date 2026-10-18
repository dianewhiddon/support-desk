# Contributing

Run `npm run types` after changing Worker bindings. Generated binding declarations stay separate from browser DOM types. [DESIGN.md](DESIGN.md) records the implemented visual system.

Use an issue for a reproducible bug or proposed change. Keep pull requests focused on one behavior and describe what users will experience differently. Contributions are voluntary and licensed under MIT.

1. Install the locked dependencies with `npm ci`.
2. Make the change, with a regression test for a bug or new behavior.
3. Run `npm run format`, then `npm run verify` and `npm audit`.
4. Describe the result and any migration in your pull request.

Keep client data, real attachments, credentials, `.dev.vars`, database files and local screenshots out of commits. Tests use fictional fixtures. Do not test against anyone's production desk.

## Conventions

- Small ES modules; server routes handle HTTP and delegate behavior to `src/lib`.
- Parameterized SQL. Use one D1 batch for writes that must succeed together.
- Revisions protect edits; idempotency keys protect retries. Test both success and stale/repeated requests.
- Shared theme tokens and existing components. Keep keyboard focus, explicit labels and 44px controls. Check light/dark at 320, 390 and 1440 pixels.
- New numbered migrations; never rewrite a migration someone may already have applied. Document the compatible release order and recovery.
- No network requests in unit tests. Inject email/model adapters and use local storage doubles.
- Do not add dependencies for a short standard-library operation. Explain each new dependency and preserve the lockfile.
- Avoid guarantees the code cannot enforce, especially around AI, malware detection and email delivery.

Never submit security exploit details in a public issue. See [SECURITY.md](SECURITY.md).
