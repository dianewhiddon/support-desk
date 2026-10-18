# Contributing

Changes to how the desk works come back here as pull requests within 30 days of using them with your clients; that's in the [license](LICENSE.md). Branding, copy, `wrangler.jsonc` values and client-specific work stay in your fork. No client data, real addresses or secrets in a pull request.

Conventions:

- `npm test` and `npm run build` pass. Behavior changes come with a test; the tests run the real schema in memory (`test/helpers.js`).
- Schema changes are a new numbered file in `migrations/`, never an edit to an existing one, and the pull request says so, since every member has to apply it before deploying.
- One change per pull request. Rough is fine; we can shape it together.

I review everything. A declined change can live on in your fork. Ideas without code go in an issue, with the client problem first.
