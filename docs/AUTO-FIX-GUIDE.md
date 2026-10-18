# Auto-fix

On my own desk, I pick a client's change request and click Run auto. An agent makes the change in the site's repository, tests and builds it, releases it, confirms the live site is serving the new commit, and hands the request back to me with the reply drafted. I read the reply in chat and tell the agent to send it.

This repo includes the first two pieces. The rest is how mine is built, with the parts that depend on my setup called out.

| Piece | In this repo |
|---|---|
| AI reply drafts | Built in |
| An agent working the queue from your machine | Agent API built in; starter skill in [agent-skill/SKILL.md](agent-skill/SKILL.md) |
| Release receipts on each site | Per site, described below |
| Hosted executor (the Run auto button) | Described below |

## What I've found makes it work

**The client record is where the quality comes from.** Every client has a folder in my Obsidian vault: a README with the relationship and links, a notes file with our correspondence and history, and a record for each site with its repository, production host, who controls hosting and the maintenance plan. My agent reads the client README and site record before it touches anything, and our history before it drafts a word. The detail in those files is the difference between a reply any assistant could write and the one I would have written, and between a guessed change and the right one.

On this desk, the closest equivalent is **Client notes for AI drafts** on each client's page. In-desk drafts read it, and the agent API returns it with every request. The starter skill also takes a path to your own client file for each site.

Each of my clients also has a support profile, the file my agent reads before changing their site:

- **Arrangement:** the plan or agreement we have.
- **Included:** the work it covers, which the agent can go ahead with at any size.
- **Billed separately:** work that needs a quote from me first.
- **Exceptions:** standing exceptions I've made for this client.
- **Sources:** where their offers, voice and visual brand live.
- **Tone:** how I write to them.
- **Coming up:** scheduled work and open items, so replies don't repeat what's already planned.

A short version fits in Client notes for AI drafts. The full file goes in the skill's `desk-sites.md`.

**Ownership comes from the record, not the request.** Before any change, my agent confirms from the client's record which repository I control, the production host and who owns it, and whether a separate staging site exists. A client's name on a request proves none of that.

**Replies go through my voice skill.** Every client reply the agent drafts uses the same voice skill I write with. In-desk drafts use `src/ai/reply-voice.txt` for the same job.

**My safe-list is three items.** The agent finishes these without me:

- exact text replacements, where the request gives both the old and new wording and the old wording appears once in the repository;
- an image swap into an existing slot;
- a blog post I've already approved.

Layout, forms, scripts, SEO and metadata, config, vague requests and anything with two plausible targets come back to me with a recommendation. No agent edits a testimonial. Urgent requests lean toward me even harder, because an urgent request plus a wrong guess is the worst combination.

**Auto-release is set per client.** For approve-first clients, the agent makes, tests and builds the change, then waits for my go before pushing.

**Agents send only what I approved.** Every path ends in a saved draft. The agent shows it to me in chat, and on my OK sends it through the desk's own Send step. The desk refuses any text that differs from the saved draft.

**Blocked has four parts.** My agents can mark work blocked only with what it's waiting on, who owns that, the next action, and the condition that resumes it.

**The first pass isn't the finish.** A separate audit pass confirms the release, the draft and the remaining work before any run of mine counts as done.

**Limits live in code.** The executor's allowed files and content are enforced by a validator; the prompt repeats them so the agent stops early.

**Every write checks the revision it read, and one run per repository at a time.**

Mine is tuned to service businesses on Astro sites deployed by Cloudflare Workers Builds. The niche, fix recipes and stack sections in the starter skill are empty for yours.

## AI reply drafts

Set `ANTHROPIC_API_KEY`, write `src/ai/reply-voice.txt`, and fill in each client's notes. Click **Draft with AI** in the reply editor for a draft. Nothing drafts when a request or client reply arrives: a reply written before the work is done spends tokens and time on text you'd rewrite. If you save while Claude is writing, your save wins.

## An agent working the queue

**Agent API** (every call sends `Authorization: Bearer <AGENT_TOKEN>`):

| Call | Does |
|---|---|
| `GET /api/agent/tickets` | Open requests, urgent first, then oldest |
| `GET /api/agent/tickets/{ref}` | The request and its `revision`, client notes, whole conversation (private notes marked), file links, and the current draft with its `id` and `revision` |
| `GET /api/agent/files/{id}` | A client's file |
| `PUT /api/agent/tickets/{ref}/draft` | Save a reply draft for your review; send `draft_revision` to replace one |
| `POST /api/agent/tickets/{ref}/notes` | Add a private note |
| `POST /api/agent/tickets/{ref}/send` | Send the saved draft you approved: `ticket_revision`, `draft_id`, `draft_revision`, the exact `body`, `idempotency_key`, `then` (`waiting` or `resolve`) and an optional resolution `note` |
| `POST /api/agent/tickets/{ref}/state` | Resolve, dismiss, mark waiting or reopen: `action`, `revision`, and for dismiss `reason` (`duplicate` with `duplicate_ref`, or `not_needed`) |

Send goes through the same step as Send on the desk, and only when the draft's id, revision and text all match. A 409 means nothing was sent. Once the reply is out the answer is `ok: true`, even if the request didn't end where `then` asked (`state.ok: false`), so an agent never resends. A repeated `idempotency_key` never sends twice, even after the request is closed.

**The starter skill** reads one request at a time, reads the client file, makes safe-list changes in the mapped repository, runs tests and build, pushes for auto-release sites or leaves a branch otherwise, adds to the client's history, leaves a note and a voice-skill draft, and sends that draft when you approve it in chat. Site-to-repository mapping lives in `desk-sites.md`.

Sites without a repository (WordPress, Squarespace, Webflow) still get triage, a precise draft and a note; the edit stays manual unless you have a staging site and an API to point the skill at.

## Release receipts

My agents report a change as live only when the site's receipt shows the commit they pushed. Each site serves, at `/__release` or similar:

```json
{ "ok": true, "commit": "<40-character git SHA>", "branch": "main", "build": "<build id>" }
```

It's generated at build time from the CI's commit variables (Workers Builds, Netlify and Vercel all expose the SHA). The agent pushes, polls with caching off until the commit matches, and records a blocker after about ten minutes. Without build variables, a content-hashed asset changing plus the change appearing on the page is weaker proof that still beats none.

## The hosted executor

Run auto does the whole fix on GitHub's machines. In the order the work happens:

**1. Readiness.** A request can run only when the desk knows its exact site, the site maps to a repository and production host, the site is marked as mine to change, and its profile (which decides allowed files and test commands) is known. Anything else shows "manual only" with the reason. My site → repository → host → profile table syncs from my vault; four fields on the desk's sites table would do the same.

**2. Start and lock.** The desk claims the request at the revision it saw and creates a run record. Two partial unique indexes allow one active run per request and one per repository. Statuses: dispatching, running, verifying, deploying, closeout, completed, plus blocked, failed, cancel requested and cancelled.

**3. Dispatch.** The desk starts a `workflow_dispatch` run through a GitHub App with `actions: write` on the workflow's repository, signing the App JWT with WebCrypto RS256 inside the Worker. A fine-grained token scoped to that repository works for a single person, with a longer-lived secret to protect.

**4. The workflow proves who it is.** Every call back to the desk carries a GitHub Actions OIDC token. The desk checks the signature against GitHub's keys and requires the exact repository, `refs/heads/main`, workflow file and `workflow_dispatch`. The first workflow run to call in owns the run record. A shared Actions secret is the simpler, weaker alternative.

**5. Five jobs, split by what they can touch.**

1. **Prepare** (read-only token): fetches the request context, checks out the site repository at the exact commit the desk recorded, and packs it without `.git`, `.github`, `node_modules` or environment files.
2. **Edit** (no credentials): installs dependencies, then runs the agent on the packed copy. Mine runs OpenAI's Codex action; Claude Code's GitHub Action fills the same slot. The agent makes the change or writes a four-part blocker.
3. **Validate** (no credentials): diffs the edit against the original, rejects anything outside policy, and writes a manifest of changed files and their hashes.
4. **Test** (no credentials): applies only the manifest's files to a fresh copy, rechecks every hash, and runs the profile's fixed test and build commands.
5. **Release** (write token): the desk issues the write token only when the run is at release, the request is unchanged and `main` is still at the starting commit. The job commits the manifest, pushes, and polls until the desk confirms GitHub and the live receipt both show the commit.

A final job records a blocker if anything above failed.

**6. Policy.** Mine is narrow because it pushes to live sites with no human diff review:

- `.html`, `.css`, `.scss`, `.md` and `.txt` only
- `src/content/`, `src/styles/` and `public/` only; components and layouts are out
- no deletions, hidden files, `..` paths, or paths naming api, server, worker, auth, security, middleware, secrets or build config
- no script, iframe, form, embed or event handlers in HTML, no `@import` in CSS, no `javascript:` or `data:` URLs
- 1 to 40 files, 1 MB at most

**7. Closeout.** When the receipt matches, the desk marks the work complete and returns the request to me with a note naming the verified commit and build. The reply draft is waiting for my OK.

Mine pushes straight to `main`. Having the release job open a pull request instead keeps the whole pipeline and puts a one-click approval on each change.

## Prerequisites for the executor

- [ ] Each client site in its own GitHub repository, deploying from `main`
- [ ] Repeatable test and build commands with a lockfile
- [ ] A release receipt on each site
- [ ] A site → repository → production host → profile table the desk can read
- [ ] A GitHub App or scoped token for dispatch, and one with write access to the site repositories
- [ ] An agent that runs in GitHub Actions, with its key in Actions secrets

A clean, optional executor in this repo is the pull request I'd most like to see.
