# Support Desk

Your clients stop sending change requests to your inbox. They sign in with an emailed link, send a request with photos, voice notes and files, and follow the whole conversation in one place. You work every request from one queue, urgent first.

This is the support system I run for my own clients at Sway Rise Creative, rebuilt as a clean starter for Rabbit Hole members. It runs on Cloudflare (Workers, D1, R2) with Resend for email. Most small studios stay inside the free tiers.

## What your clients get

- **Sign-in without passwords.** They enter their email and get a one-time link. Nobody you haven't added can sign in.
- **One form for changes and questions.** They can pick the website and page, flag an emergency, record a voice note in the browser, and attach images, PDFs, audio, Word or text files.
- **The full conversation on every request,** with your replies, your files and their replies in order. Unsent words stay in their browser if they close the tab.
- **A receipt for every request.** An email and the request page confirm it arrived and say what happens next.
- **A one-tap check when you finish.** "Yes, all good" or "Something is off," which reopens the request and emails you.

## What you get

- **AI reply drafts when you ask.** Draft with AI writes a reply in your voice into your reply editor. Nothing drafts a reply when a request arrives, because the reply belongs after the work. Your voice comes from one text file; each client's business, offers, voice and history come from their notes. The drafts are as good as those notes.
- **A queue sorted the way the work happens:** Needs you, Waiting on client, History. Urgent requests sit at the top. Search covers clients, references and request text.
- **A reply editor with saved drafts and private files.** Attach Word, PowerPoint, Excel, PDF or images; they stay private until you send. Send and wait for the client, or send and resolve in one click.
- **Private notes** on any request that clients never see.
- **Resolve, dismiss (duplicate or no longer needed), mark waiting, reopen,** with a status history on each request.
- **Email you can trust.** Every notification is recorded, sent once, and shows whether it was delivered, bounced or failed, with a retry button.
- **Client management:** add clients, their websites, their time zones, and turn sign-in off without losing their history.

## Let your AI agent work the queue

The agent API lets Claude Code read open requests, download the files, make the change in the client's site, and leave you a reply draft and a private note. Approve the draft in chat and the agent sends exactly that draft and resolves the request, or send it from the desk yourself. [docs/AUTO-FIX-GUIDE.md](docs/AUTO-FIX-GUIDE.md) is how I run mine, through to fixes that release themselves.

## Built to be hard to break

- Every uploaded file is checked by its contents, not its name. Office files with macros are refused.
- Clients can only open their own requests and files. Private notes and unsent draft files never reach them.
- Double-clicks, resubmitted forms and two open tabs can't create duplicates or overwrite newer work.
- Sign-in links work once, expire in 30 minutes, and are rate limited. Turnstile is one setting away if you want it.
- Your agent can send only the exact draft you approved, and a repeated call never sends it twice.
- AI drafts never overwrite a reply you are writing, never see your private notes, and treat client text as data, so a message telling the AI what to do produces a plain acknowledgement instead.

## Get started

[docs/SETUP.md](docs/SETUP.md) takes you from fork to a live desk on your own domain.

## Make it better with us

Improvements come back here as pull requests. [CONTRIBUTING.md](CONTRIBUTING.md) has the conventions, and the [member license](LICENSE.md) makes it part of the deal.

## Tests

```bash
npm test
```

The tests run the real database schema in memory and cover requests, replies, files, email delivery and access rules.
