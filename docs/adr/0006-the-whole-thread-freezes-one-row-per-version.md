# The whole Thread freezes, one row per Version

ADR-0003 freezes a Thread on every Version but the latest. That freeze covers more
than the Comment list. ADR-0004 gives a Thread a link state and a resolved position
that are recomputed at every Upload, and `Readme.md:74` lets a Reviewer place an
Unlinked Thread by hand. All of it differs per Version, and all of it is frozen.

So a Thread has **one row per Version it appears on**, carrying its Linked or
Unlinked status, where its text sits in that Version, and where it was placed if it
has no text. The row is written when the Version is created and never touched again
once that Version stops being the latest. Freezing is not an operation; it is the
absence of one.

```sql
create table thread_versions (
  thread_id       uuid not null,
  book_id         uuid not null,
  version_number  int  not null,
  status          text not null check (status in ('linked','unlinked')),
  text_position   int4range,
  thread_position jsonb,
  primary key (thread_id, version_number),
  foreign key (thread_id, book_id)      references threads(id, book_id) on delete cascade,
  foreign key (book_id, version_number) references versions(book_id, number),
  check ((status = 'linked')   = (text_position   is not null)),
  check ((status = 'unlinked') = (thread_position is not null))
);
```

A Thread linked on v3 and Unlinked on v4 has a row for each, and reading v3 reads
v3's row. Nothing about v4 can reach it. A Thread that re-links on v5 draws beside
its text there while v4 still draws it where a Reviewer dragged it, because each
Version renders from its own row and no row can see another.

## Comments freeze differently, and must

A Comment carries the Version that was latest when it was written, and reading
Version N shows the Comments where that number is at most N. There are no per-Version
Comment rows.

The asymmetry is forced by the data, not chosen. A Comment written on v3 was always
going to be a v3 Comment; nothing later changes that, so its membership is a stored
fact plus an inequality. A Thread's position is **recomputed** at every Upload —
matching runs fresh against text the Author edited offline, and no arithmetic turns
v3's position into v4's — so it has to be materialised per Version.

Positions are absolute character ranges into a Version's extracted text, so an edit
anywhere earlier in a Book moves every later Thread's position. Storing only the rows
that changed would therefore store almost every row anyway, and read them through a
lateral lookup instead of an index scan.

## Visibility and state are two integers

A Thread stores the Version it was created on and, once Resolved, the Version that
was latest when the Author Resolved it. Those two numbers are its visible range,
inclusive at both ends: created on v2 and Resolved on v5 means visible on v2, v3, v4
and v5, and absent from v6. This is ADR-0002 stated as arithmetic.

They also carry the state ADR-0003 asks for. A Thread reads Resolved on Version N
exactly when it has a resolution Version and N is at or past it — so a Thread created
on v2 and Resolved on v5 reads Open on v2, because that is what it was when v2 froze.
No state is stored per Version.

This works only because a Thread is never reopened (`Readme.md:48`). Resolution is a
one-way step, and a step is fully described by where it steps. Were reopening ever
added, state stops being derivable and every per-Version row grows a state column.

A Resolved Thread is immutable but still renders on every Version in its range,
including the one it was Resolved on while that Version is still the latest. There is
no rule anywhere that depends on which Version is current.

## Linked and Unlinked are stored, not derived

`CONTEXT.md:59` names Linked and Unlinked as a domain state, so `status` is a column
that says which one it is. Deriving it from whether a position happens to be null
would make a reader reconstruct a named concept from an absence. The two CHECK
constraints keep `status` and the two position columns from ever disagreeing;
the redundancy is deliberate and costs a line.

`text_position` is null exactly when Unlinked, and `thread_position` is null exactly
when Linked, because a Linked Thread is drawn beside the text it is linked to and
needs no placement of its own.

## No Block, anchor or placement table

`CONTEXT.md` gives this area three words — Block, Linked, Unlinked — and the model
uses no others. A Block is the passage a Thread is rooted on; in the schema that is
the `text_position` of a Linked row, not a table. Earlier drafts of this decision
introduced an `anchors` table, from a word appearing once in ADR-0004's prose, and a
`placements` table beside a `blocks` one. Both were rejected: a `blocks` table would
have had to hold rows for Threads that have no Block, which contradicts the glossary,
and splitting the row in two produced a mutual-exclusion invariant spanning two
tables to describe one thing.

`thread_versions` is named after its two parents on purpose. A join table introduces
no vocabulary, and this decision adds no term to `CONTEXT.md`.

## The extracted text is stored, not re-derived

ADR-0005 extracts a Version's text at Upload, and every `text_position` is a character
range into that string. The string is written once to the Version's storage prefix,
beside the HTML it came from.

Re-deriving it on demand was rejected. Sanitisation is already frozen — a growing
allowlist cannot change text already stored — but the extraction rules themselves are
not: which elements are segment boundaries, `<br>` contributing a space, tables
excluded. Change any of them and re-extracting v1 yields a string v1's positions no
longer index into. Pinning an extraction-rules generation onto each Version would fix
that at the price of keeping every retired extraction implementation in the codebase
forever, tested forever, where a bug in a path nobody runs corrupts old Versions in
silence. Storing the output is a few hundred kilobytes per Version and is provably the
string the positions were resolved against.

## Comments are editable until their Version freezes

A Comment can be edited or hard-deleted by whoever wrote it, on the latest Version
only. The freeze rule needs no extension to make this safe: a Comment stamped with an
earlier Version is already unreachable, so nothing frozen can be altered or lost.
Deleting the last Comment in a Thread deletes the Thread — a Thread is started by
writing its first Comment, and an empty Thread is a highlight with no discussion,
which is not a thing `Readme.md` has.

## The invariants live in Postgres

Supabase exposes PostgREST, so the application is not the only writer that will ever
exist and an invariant enforced only in it is enforced nowhere. Beyond the CHECK
constraints above, triggers hold the rules that need a second row: Versions are
immutable and numbered one past the latest; a Thread is started, a Comment written,
and a resolution recorded only on the latest Version; a resolution is set once and
never cleared; a Comment's Version is computed at insert rather than supplied; and
nothing may update or delete any row belonging to a Version that is no longer the
latest.

Three constraints are deliberately absent. There is no global uniqueness on a
Version's content hash, because ADR-0005 compares against the latest Version only and
a revert is a genuine new Version. There is no exclusion constraint over
`text_position`, because `Readme.md:30` allows selections to overlap. There is no
guard against selecting a table or an image, because ADR-0005 leaves them out of the
extracted text, which makes them unaddressable rather than forbidden.

## Consequences

**Reopening a Thread stops being cheap to add.** State is derivable from one integer
only while resolution is monotone. It is out of scope today, and this model depends
on that.

**An Upload writes one row per Open Thread.** A Book with two hundred Open Threads
across thirty Versions accumulates six thousand rows, inside a transaction that is
already parsing and sanitising a whole document.

**The visible-range predicate is load-bearing on every read.** Per-Version rows exist
only inside a Thread's range, so a query that joins them without the range filter is
correct today by accident. The range is the visibility rule; the rows are not.

**`thread_position` must be derivable from a character range.** When an Upload
Unlinks a Thread it computes a starting placement from the previous Version's
`text_position`, or carries the previous placement forward if that Version was
Unlinked too. A placement expressed in rendered pixels or DOM coordinates could not be
computed this way.
