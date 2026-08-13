# One Book-access check gates every read and write

`Readme.md:50` gives an Author only their own Books and `Readme.md:57` gives a
Reviewer only the Books they were granted. Supabase publishes the database over
HTTP, so a signed-in person holds a token that reaches every table directly and
the web app is not the only client that will ever exist. The boundary therefore
has to be in Postgres, and it has to be the same boundary everywhere.

Row-level security is on for every table, `anon` holds no privilege on anything,
and one function answers the only access question the product has:

```sql
create function public.can_read_book(book uuid) returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.books b
    where b.id = book
      and (b.author_id = (select auth.uid())
        or exists (
          select 1 from public.book_reviewers r
          where r.book_id = b.id and r.reviewer_id = (select auth.uid())
            and r.revoked_at is null))
  );
$$;
```

Every table under a Book carries `book_id` and its policies are one call to that
function. `threads` and `thread_versions` already carry it (ADR-0006);
`comments` gains it, pinned to its Thread by a foreign key to
`threads(id, book_id)` so the two can never name different Books. The column is
redundant and deliberately so: the alternative is a policy on `comments` that
joins up through `threads` to `books`, which states the same rule a fourth time
and drifts on the fifth table.

`security definer` is not an optimisation here. The policy on `books` reads
`book_reviewers`, and the policy on `book_reviewers` reads `books`; evaluating
either inside the other's policy is a cycle that Postgres refuses. A definer
function sees rows without policy checks, which breaks the cycle and lets the
planner treat the result as a constant rather than re-deriving it per row.

## The grant

A grant is a row: `book_reviewers(book_id, reviewer_id)`, unique on the pair,
referencing an account that already exists. Revoking **marks** the row with a
`revoked_at` and never deletes it — this decision originally deleted it, which
ADR-0011 found to contradict the promise below that a revoked Reviewer's address
stays visible. Reading requires an unrevoked row; reading an address accepts any
row.

Keying on the Reviewer's **account id** rather than their email address was the
close call. Email is what an Author types and what ADR-0001 describes the grant
as being keyed by, and an email-keyed list needs no account to exist when the
row is written. It was rejected because a grant is a lasting relationship and an
email address is not: a Reviewer who changes theirs silently loses every Book,
and an address later reassigned to someone else silently gains them. Access that
turns on by itself, months later, with nothing written to say so, is the failure
this whole decision exists to prevent. The account id also keeps the identity a
policy compares to the one thing ADR-0009's Upload already injects, so no policy
needs an email claim to be present.

Because accounts are precreated (ADR-0001) and the account list is not readable
(see below), the Author cannot resolve a typed email to an id themselves.
Granting is therefore a single call:

```sql
public.grant_access(book uuid, email text)
```

`security definer`, run as the Author, which checks that they own the Book,
lowercases and trims the address, looks up the account, and refuses three
things: an address with no account, a Book with no Versions yet (ADR-0008), and
a grant that already exists **and is not revoked** — granting a revoked address
clears its mark rather than refusing (ADR-0011). It answers "granted" or names
which refusal applied. Making the grant a function rather than an insert is what lets the
lookup happen somewhere the Author cannot read, and it puts ADR-0008's
zero-Version refusal in the one place a grant can be created rather than in a
trigger that exists to catch a path the app never takes.

A Book's Reviewer list is readable by everyone on that Book. A Reviewer seeing
who else is reviewing is the same disclosure as seeing who wrote each Comment,
which `Readme.md:63` requires anyway.

Revoking removes reading and nothing else. Every Comment and Thread the Reviewer
wrote stays exactly as it was, their address still shown beside it — deleting
their words would tear holes in discussions other people are still having and
would destroy the Author's own record of the review. The kept row is what makes
that address readable: the rule below is *shares a Book*, and only a row that
outlives the revoke satisfies it.

## Rows, columns, and timing are three different questions

Three rules meet on `threads` and they are not the same kind of rule. *Anyone
with access may link, move or unlink* is about which rows. *Only the Author
Resolves* is about which column. *Only on the latest Version* is about when.
Each gets the mechanism that can actually express it.

**Policies decide which rows.** A Reviewer's `update` policy on
`thread_versions` is `can_read_book(book_id)`; an Author's policy on `books` is
`author_id = (select auth.uid())`.

**Column privileges decide which columns.** `grant update (status,
text_position, thread_position) on thread_versions to authenticated` and nothing
more. The Version a Thread was Resolved on is granted to nobody, so Resolving
goes through a `security definer` function that checks authorship and raises.

Expressing "only the Author Resolves" as a policy instead was rejected on its
failure mode. A policy filters rows; an Author-only `using` clause on an update
a Reviewer attempts matches zero rows and reports success with zero rows
affected. A missing privilege is a permission error. When a rule exists to stop
something, it should stop it loudly.

**Triggers decide when.** ADR-0006 already assigns the latest-Version rules
there, and nothing here moves them.

## Freezing is not access control

ADR-0003's cut-off — Version N shows the Comments written at or before N — is
not expressible as a policy, because a policy cannot know which Version is on
the reader's screen. Threading that through a session variable set by the client
was rejected outright: the client would then be choosing what the policy
enforces, which converts a display bug into a privilege bug.

It does not need to be a policy. The boundary that must fail closed is the
**Book**. A forgotten cut-off shows a Reviewer newer Comments on a Book they are
already entitled to read; a forgotten `book_id` filter would show them another
Author's manuscript. Only one of those is a breach.

So the cut-off lives in one shared read — a `security invoker` function taking a
Book and a Version number and returning that Version's Threads and Comments,
with ADR-0006's visible-range predicate and ADR-0003's Comment cut-off both
inside it. Every page that opens a Version goes through it. Left to each query,
the omission is invisible: the page still renders, and the only symptom is that
an old Version quietly stops being a sealed record.

## Identity

`auth.users` is not readable by a client, so a `public.users` table holds the
account id and the email address, kept in step with `auth.users` by a trigger on
insert. It is readable only where the reader and the subject share a Book, which
a revoked grant row still counts as (ADR-0011) — the one place a join is
unavoidable, and worth it. Making it readable to every
signed-in account would have been simpler, and was rejected because the platform
holds unpublished manuscripts under private review, where the fact that a
particular person is on it at all is itself a disclosure.

Email is the only identity shown. A display name is the obvious next column and
is deliberately absent until someone asks for it.

`public.users` adds no word to `CONTEXT.md`. It is the readable shadow of a
sign-in account, not a domain concept: Author and Reviewer remain the only two
kinds of person, and neither is a column on it. The name is schema-qualified
everywhere it appears, because `auth.users` exists beside it and the two must
never be confused.

## Storage

Both buckets are private and both are governed by policies on
`storage.objects`, not by an application route holding the master key. ADR-0005
says a route mediates every asset request and checks access; this makes that
check the database's, so a route that forgets it leaks nothing.

The path is what the policy reads, so the path has to name the Book first:

- Versions: `{book_id}/{version_number}/index.html`, and assets beside it at
  their original relative paths. Readable when `can_read_book` says so, writable
  only by the Book's Author.
- Staging (ADR-0008): `{book_id}/…`, the Author's alone, no Reviewer clause.

ADR-0009's confirm copies staged objects to the Version prefix **as the Author**,
under those same policies, rather than with the master key. The prefix is
computed from the Book and the Version number and never supplied by a caller, so
the `versions` row's pointer and the objects' real location cannot disagree.

## The master key

The `service_role` key bypasses every rule above. It lives on the server, in the
operator's seed script, and nowhere else — not in the browser, not in a
background job, not in an admin page. Every rule in this decision is worth
exactly as much as the number of places that skip it, and one convenient
master-key route added later undoes all of it silently.

## Consequences

**An Author can corrupt their own Book's numbering, and we accept it.** The
Upload runs as the Author (ADR-0009), so their token must be able to raise
`latest_version_number`. Pointed at the API by hand it can raise it without
Uploading anything, leaving Reviewers on a latest Version that does not exist and
a permanent gap once the next real Upload lands one higher. Guarding it with a
deferred check that the matching `versions` row exists at commit was considered
and dropped: it only damages the Author's own Book and takes deliberate effort.

**A new table is insecure by omission, not by commission.** Fails-closed is the
absence of a policy, so the danger is a table created without RLS enabled and
without privileges revoked — a table nobody wrote a rule for is wide open, and
looks finished. Every migration adding a table under a Book has three
obligations: `book_id`, RLS enabled, policies written.

**Every `security definer` function is a hole in its own boundary.** Three exist
— the access check, the grant, and Resolve — and each sees rows no policy
filtered. Each must check by hand what the policy would have checked, and
`set search_path = ''` on all of them, or a caller-controlled search path
redirects the tables they read.

**Granting reveals whether an address has an account.** The Author must be told
which of "granted" and "no such account" happened, so the grant call is an
oracle over the account list. It is one bit, to an Author, about an address they
already typed.

**A revoked Reviewer's address stays visible** to everyone still on the Book,
because it is attached to Comments that stay. Revoking is not erasure and cannot
be sold as one. It is also not eviction: the revoked Reviewer keeps whatever page
is already in front of them until their next request (ADR-0011).

**`public.users` can drift from `auth.users`.** An account created by any route
that skips the trigger is invisible to the grant lookup and shows no address
beside its Comments. The seed script is the only creator today, which keeps the
surface at one.
