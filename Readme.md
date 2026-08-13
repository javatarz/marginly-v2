# Marginly — Problem Statement

A review platform where an Author shares a Book with invited Reviewers, and those
Reviewers discuss it in place by highlighting any passage and commenting on it.

Vocabulary is defined in [`CONTEXT.md`](./CONTEXT.md). Decisions are recorded in
[`docs/adr/`](./docs/adr/). Open questions are tracked on
[the map](https://github.com/javatarz/marginly-v2/issues/1).

## Running it

Two runtimes in one repo, sharing no code (ADR-0013): a Next.js App Router app on
Node in `src/`, and Supabase Edge Functions on Deno in `supabase/functions/`, with
plain SQL migrations beside them.

```
npm install                # the Node runtime
supabase start             # the local stack (Docker)
supabase db reset          # apply the migrations
npm run db:types           # regenerate src/lib/database.types.ts (checked in)
npm run verify             # the gate: no leaked keys, lint, both typechecks, stale types, both suites
npm run build && bash scripts/restart-app.sh   # a production build, served by next start
bash scripts/deploy.sh     # verify, db push, functions deploy, build, restart
```

`npm run verify` is the only gate — there is no pull request — so it runs before
every commit. A migration and its regenerated types are committed together, or the
gate fails.

## Content

A Book is written and edited entirely outside Marginly. Nothing is editable in
the platform — only Threads and Comments are added.

An Upload sends a zip holding one `index.html` plus its images, and creates a new
immutable Version. A Book keeps every Version, and all of them stay readable. An
Upload whose content is identical to the latest Version creates nothing and says
so.

The HTML is sanitised on the way in, and the Author is told how many tags were
removed. See ADR-0005.

**Marginly does not use the Author's styling.** A zip may carry stylesheets and
they are accepted, but nothing in them renders — every Book is read in Marginly's
own typography, and the Author's tags rather than their CSS carry what survives.
Images render. See ADR-0012.

A Version renders as a single page — no pagination, no chapter splitting.

## Threads

A Thread is a discussion rooted on one Highlight — the passage of text a Reviewer
selected to start it. A selection may run across paragraphs and may overlap
another Thread's, but it never covers an image or a table.

- A Thread can be started only on a Book's **latest** Version.
- While a Thread is Open it is carried into each new Version, staying beside its
  Highlight. An Upload finds that Highlight again by exact text match; where the text has
  been edited or cut, the Thread becomes **Unlinked** — still Open and still
  commentable, but beside no text until someone links it again. See ADR-0004.
- The Author and any Reviewer with access can link an Unlinked Thread, move a
  linked Thread to different text, or unlink one, on the latest Version only.
- Comments can be added only on the latest Version, by the Author or by any
  Reviewer with access.
- On an earlier Version a Thread is **Frozen**: read-only, showing exactly the
  Comments it held and the state it was in when the next Version arrived, and
  nothing of what followed. If v1 held three Comments when v2 was Uploaded, v1
  shows those three forever.
- Only the Author Resolves a Thread, optionally leaving a final note as a
  Comment. Resolving ends the carry — a Thread Resolved while v5 was latest is
  visible on v2–v5 and absent from v6.
- A Thread is never reopened. Raising the point again means a new, separate
  Thread.

## Author

1. Sign in with an email magic link.
2. See a dashboard of their own Books and each Book's Versions.
3. Upload a new Version of a Book, and hold several Books at once.
4. Read any Version of any Book they own — and only Books they own.
5. Read Threads beside the text, each tied to its Highlight, with every commenter's
   role shown.
6. Comment on any Thread, marked as the Author of the Book.
7. Resolve a Thread.
8. Link, move, or unlink a Thread on the latest Version.
9. Grant a Reviewer access to a Book.

## Reviewer

1. Sign in with an email magic link.
2. See a dashboard of the Books they have been granted and each Book's Versions.
3. Read any Version of a granted Book, including Versions Uploaded before the
   grant.
4. Start a Thread on any passage of the latest Version.
5. Comment on any Thread on the latest Version, including Threads started by
   other Reviewers or by the Author.
6. Read Threads beside the text, with every commenter's role shown.
7. Link, move, or unlink a Thread on the latest Version, and place an Unlinked
   Thread anywhere on the page.
8. Cannot Resolve a Thread.

## Access

Every Author and Reviewer account is precreated by an operator. There is no
signup flow, and sign-in is an email magic link.

Granting a Reviewer access to a Book gives an account that already exists
permission to read it. No invitation email is sent, so a Reviewer discovers a
Book — and any reply to their Comments — from their dashboard. See ADR-0001.

## Out of scope

Notifications of any kind beyond the magic-link email, self-serve signup, search,
analytics, download prevention, editing a Book in the platform, reopening a
Resolved Thread, and Reviewer-initiated resolution.
