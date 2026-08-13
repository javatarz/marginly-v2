# An Upload does its work before the confirm and becomes a Version in one transaction

ADR-0008 makes an Upload confirmed rather than immediate, and ADR-0005 makes the
preview show extracted text. Together they force the expensive work — unzip,
hash, sanitise, scope CSS, extract, segment — to happen *before* the Author
confirms, because the preview cannot be rendered without it. So the confirm is
not where the Upload does its thinking. It is where the Version comes into
existence, and it is cheap.

The Upload therefore has two halves:

**The preview** unzips the bundle, sanitises it, extracts its text and writes all
of that to a staging prefix, then shows the Author what they are about to land.
Nothing in `versions`, `books` or `thread_versions` is touched.

**The confirm** copies the staged objects to the Version's `storage_prefix`,
re-matches every Open Thread, and writes the Version, the version-number bump and
one `thread_versions` row per Open Thread in a single transaction.

A Version becomes readable the moment that transaction commits, and never before.
There is no window in which a Version exists with an incomplete carry.

## The preview

**ADR-0014 settles the shape.** The browser sends the zip to the Book's staging
prefix in Storage, and then one Edge Function invocation — given a path, not a
body — does the whole preview. The Author sees one indeterminate loader for the
whole wait: transfer and processing are not distinguished, because once the bytes
have moved the rest is under half a second. ADR-0014 also refuses `index.html`
above 10 MB, where memory rather than CPU binds.

The bundle is hashed and compared against the latest Version's hash per ADR-0005.
A match **refuses** the Upload outright: there is no preview to confirm and no
override. An identical Version is not a harmless no-op — it Freezes every Thread
on the current latest Version and starts a fresh `thread_versions` row set, so a
Reviewer's live discussion goes read-only for a Version that changed nothing, and
ADR-0008 gives no undo. The comparison happens here and only here; the confirm
does not repeat it.

Everything under the Book's staging prefix is **deleted** before the new bundle is
written. Overwriting alone is not enough. It replaces only the paths the new zip
also contains, so an asset present in an earlier abandoned bundle and absent from
this one survives into a tree that is now a mix of two Uploads — and the confirm
would copy that mix into a permanent Version. The preview cannot reveal it,
because ADR-0008 renders the preview as plain text with no images. The visible
failure would be a Reviewer seeing an image from a bundle the Author never
confirmed, where ADR-0005 promises them a cannot-be-rendered message.

A Book holds at most **one** unconfirmed bundle. A second preview on the same Book
replaces the first, because it means the Author changed their mind about which
file to Upload and keeping both would give them two confirm buttons for one
intent.

Open Threads are **not** matched here. This decision once ran the match in the
preview and threw the result away, purely to fill an Unlink count; ADR-0014
removes the count, so the pass has no consumer and does not run. Matching happens
once, in the confirm.

## The confirm

Storage first, then the transaction. The staged objects are **copied** — not moved
— to the Version's `storage_prefix`, and the staged bundle is deleted only after
the transaction commits.

Storage writes cannot join a Postgres transaction, so one side of that boundary is
always exposed, and the choice is which failure to own. Copying first can leave
objects at a prefix no `versions` row points at: dead bytes, unreadable, of a kind
ADR-0008 already tolerates. Writing the rows first would leave a `versions` row
that *is* the latest and whose content is missing — a Book broken for every
Reviewer until someone intervenes. A rollback runs a compensating delete over the
copied objects, but that is an optimisation and not a guarantee: a process killed
between the copy and the rollback cleans nothing, so an unreferenced storage
prefix has to be harmless by design.

Copying rather than moving is what makes a failed confirm retryable. The staged
bundle survives the rollback, so the Author confirms again from the same preview
instead of re-sending up to 50 MB over a transient database error.

Matching runs here, and only here, against the Thread set read inside this
transaction. Running it earlier and reusing the result was rejected even while the
preview still did it, and not on grounds of cost — matching is a millisecond
string pass. The Thread set moves while the
Author reads the preview. An Author who Resolves a Thread and then confirms would
insert a `thread_versions` row for a Resolved Thread, which ADR-0006 forbids; a
Reviewer who starts a Thread in the same window would get no row for it, so a
discussion opened seconds earlier would be silently absent from the new Version
and indistinguishable from a Resolved one. The rows have to be computed against
the Threads they are written beside.

The extracted text is read back from Storage rather than carried in the staging
row. It is a few hundred kilobytes per ADR-0006 and has to reach the Version's
prefix regardless, so keeping a second copy in a row that exists to be deleted
buys nothing.

### One transaction, and why it is not an RPC

The transaction covers the version-number bump, the `versions` insert and every
`thread_versions` row. Nothing partial: either the Version exists with a complete
carry or it never existed.

The ticket this decision resolves worried about matching succeeding for some
Threads and failing for others. That is not a state this system can reach.
Matching is a pure in-memory string search whose no-match outcome is *Unlinked* —
a domain result under ADR-0004, not an error. There is no per-Thread exception to
survive, only a crash mid-loop, and the transaction covers that. The silent
failure the ticket feared — an incomplete carry indistinguishable from a Book
whose text genuinely changed — is unrepresentable rather than merely unlikely.

PostgREST cannot express this. One HTTP request is one statement in its own
implicit transaction, with no way to send `BEGIN`, three statements and `COMMIT`,
so the three writes would be three transactions and a crash between them is
exactly the partial carry above. The Edge Function therefore opens a **raw
Postgres connection** and issues explicit transaction control, with the statements
written in TypeScript.

A `security invoker` Postgres function called through `rpc()` would also have been
one transaction, and would have kept RLS working for free. It was rejected because
it splits the Upload across two languages: ADR-0004's whitespace normalisation and
tie-break rules already have to run in TypeScript — Postgres cannot read Storage,
so it cannot see the extracted text — and the writes that follow belong next to
them rather than in plpgsql behind a row-array parameter.

### Identity on a raw connection

A raw connection authenticates as a database role, not as a user, so the function
reproduces by hand what PostgREST does implicitly. Inside the transaction, before
any write:

```sql
set local role = 'authenticated';
set local request.jwt.claims = '{"sub":"<author id>","role":"authenticated",...}';
```

`auth.uid()` reads `sub` out of `request.jwt.claims`, so without both settings
every RLS policy evaluates against nothing. The claims are trustworthy by the time
they are injected: the runtime verifies the JWT's signature before the function
body runs.

The connection role is **privilege-free** — it owns nothing and holds no grants on
any table. The alternative, connecting as the owner and dropping privilege with
`set local role`, was rejected on failure mode rather than effort: it is the same
line of code, but a path that forgets it runs as an owner, owners bypass RLS
entirely, and an Author would write another Author's Book with nothing raising an
error. A privilege-free role turns the same mistake into a permission error before
any row moves.

Both settings are `LOCAL`. The connection arrives through Supavisor in transaction
mode, which pins it to one transaction for that transaction's lifetime — a
session-level `SET` would outlive the transaction and leak one Author's identity
into the next caller's. Transaction-mode pooling also rules out prepared
statements. Direct connections were rejected: an Edge Function can cold-start per
invocation and would burn the database's connection limit holding connections for
well under a second each.

## Concurrent Uploads and concurrent Comments

Two confirms on the same Book stack rather than collide. The number comes from
`update books set latest_version_number = latest_version_number + 1 ... returning`,
and that UPDATE takes a row lock on `books` by itself, so the second transaction
waits, reads the committed value, and lands one Version higher. There is no
duplicate-number case for the primary key to reject and no error screen to build.
Only an Author Uploads to their own Book (ADR-0008), so this is two sessions of
one person, not two people.

ADR-0006's decision not to lock against concurrent **Comments** stands unchanged,
and this does not contradict it. What it refused was holding a lock for the
duration of a parse-sanitise-rematch cycle; that cycle now happens in the preview,
outside any transaction, and the confirm holds its lock only for row writes.

## Consequences

**The synchronous preview survives, over a staged zip.** This ADR once concluded
the opposite. Issue 15 measured an Edge Function at **2 s of CPU time per
request**, with a 546 and no partial result beyond it, and unzipping up to 50 MB
and parsing a whole document did not look like it fit. ADR-0012 then removed CSS
parsing from the preview, and measurement put War and Peace at **389 ms** — roughly
5× margin, in one invocation. ADR-0014 keeps the preview synchronous and moves only
the transfer: the zip goes to Storage first, so the function reads a path rather
than a body and Storage's documented 50 MB is the real ceiling. What binds is
memory rather than CPU, and on HTML size rather than bundle size, so ADR-0014
states a 10 MB limit on `index.html` and refuses above it.

Everything from the confirm onwards stands as written: the copy, the one
transaction, `set local role`, the privilege-free role and the bump's row lock, as
do the staging prefix clearing, refuse-on-duplicate and one unconfirmed bundle per
Book.

**RLS must let an Author write a Version.** The `versions` insert and the
`latest_version_number` bump run as the Author under their own JWT, so the policy
shape has to permit both.

**There is no Unlink count.** This ADR once computed one in the preview and showed
it to the Author before the confirm; ADR-0014 removes it. The durable signal is
ADR-0007's rail, which parks every Unlinked card beside the text it used to hold.

**A failed confirm is invisible in the data and recoverable by the Author.** No
Version, no rows, and the preview still standing. The only trace is whatever the
compensating delete did not reach.

**There is one matching pass.** This ADR once warned that the preview's count and
the confirm's rows had to come from the same code or the Author would approve a
number the transaction disagreed with. With no count in the preview there is no
second implementation and no drift to guard against.
