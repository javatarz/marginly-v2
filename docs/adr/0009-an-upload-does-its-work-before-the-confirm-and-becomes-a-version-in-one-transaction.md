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

The browser posts the zip as the request body of an Edge Function, which unzips
it in memory. The Author sees one indeterminate loader for the whole wait —
transfer and processing are not distinguished, because once the bytes have moved
the rest is too fast to read.

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

Open Threads are matched here too, and the result is **thrown away**. It exists
only to fill in the Unlink count ADR-0008's preview now carries. Nothing computed
here is written, and the confirm trusts none of it.

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

Matching runs **again**, here, against the Thread set read inside this
transaction. Reusing the preview's results was rejected, and not on grounds of
cost — matching is a millisecond string pass. The Thread set moves while the
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

**The synchronous preview does not survive its runtime.** Issue 15 measured the
caps: an Edge Function gets **2 s of CPU time per request**, no plan raises it, and
exceeding it returns HTTP 546 with no partial result. Unzipping a bundle of up to
50 MB, parsing a whole document and segmenting its text does not fit, and the cliff
sits wherever the Author's markup puts it rather than at a byte count — so nothing
behind a synchronous preview can promise a ceiling on a Book at all. Memory, which
should be planned at 150 MB, rules out holding the compressed bytes, the unzipped
tree and a parsed DOM at once. The body limit this ADR feared turned out to be
undocumented and beside the point.

Two shapes remain — stage the zip in Storage and split the preview across
invocations, or keep it synchronous and run it off Edge Functions — and issue 16
settles which. Whichever wins, everything from the confirm onwards stands as
written: the copy, the one transaction, `set local role`, the privilege-free role
and the bump's row lock, as do the staging prefix clearing, refuse-on-duplicate and
one unconfirmed bundle per Book. Only the half before the Author presses confirm is
open.

**RLS must let an Author write a Version.** The `versions` insert and the
`latest_version_number` bump run as the Author under their own JWT, so the policy
shape has to permit both.

**The Unlink count the Author approves is a projection.** It is computed in the
preview and shown plainly, without hedging, because the drift needs a Reviewer to
act in the seconds before the confirm. When it does drift, the count reported
after completion differs from the one the Author agreed to, and neither is stored —
both are rendered once and discarded. The durable signal is ADR-0007's margin, which
parks every Unlinked Thread beside the text it used to hold.

**A failed confirm is invisible in the data and recoverable by the Author.** No
Version, no rows, and the preview still standing. The only trace is whatever the
compensating delete did not reach.

**Two matching passes means two implementations must not drift.** The preview's
count and the confirm's rows come from the same rules and must come from the same
code, or the Author approves a number the transaction disagrees with.
