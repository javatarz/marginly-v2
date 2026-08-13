# A Book is created before its first Upload, and an Upload is confirmed in place

`Readme.md:6` says every fresh Upload creates a Version and `Readme.md:47` gives
an Author several Books, but nothing said which Book an Upload lands on.

An Upload is started **on a Book's page**, and that page is the binding. The Book
comes from the route; the zip carries content and nothing else. Nothing inside
the bundle — a `<title>`, a first heading, the zip's own filename — is ever read
to identify a Book.

Creating a Book is a **distinct act**. The Author names it and gets a Book with
zero Versions, then Uploads v1 into it. An Upload therefore has one meaning
wherever it appears: a new Version of *this* Book.

## Why nothing is inferred from the content

ADR-0005 treats the bundle as an unaudited Word or Pandoc export, and an export
tool rewrites `<title>` whenever it likes. Binding on that makes the Book a
property of whatever wrote the file rather than of what the Author meant.

Mis-binding is also unrecoverable. A Version is immutable, this decision adds no
undo, and ADR-0004 re-matches every Open Thread in the same Upload — so a Version
landing on the wrong Book stays there and Unlinks that Book's Threads wholesale.
A binding that fails silently cannot be the binding.

A per-Book identifier or credential, letting a build pipeline Upload without a
browser, was rejected too. It is a second authentication surface beside
ADR-0001's magic links, and nothing in `Readme.md` asks for it.

## The Book's name

The name is free text the Author sets at creation and may change at any time,
unique among that Author's own Books. It is compared trimmed and
case-insensitively — a unique index on `(author_id, lower(btrim(name)))` — and
stored as the Author typed it. An empty or whitespace-only name is refused.

Uniqueness is per Author because a global rule would report the existence of a
Book the Author cannot read, and `Readme.md:50` says an Author reads only Books
they own. Comparing case- and whitespace-sensitively was rejected: a rule the
Author defeats by accident leaves two rows that read identically in the
dashboard, which is worse than having no rule.

A rename touches no Version, so ADR-0003's freeze has nothing to say about it. A
Reviewer reading v1 sees the Book's current name — the name belongs to the Book,
which persists across every Version (`CONTEXT.md:11`), and there is no frozen
name.

## A Book with no Versions

The distinct create step means a Book exists before any content does, and that
Book is Author-private. Granting a Reviewer access is refused until a Version
exists.

ADR-0001 sends no invitation, so a Reviewer's dashboard is their only route to a
Book. A granted Book that opens onto nothing is indistinguishable to them from a
broken one, and they have no way to ask. The Author loses nothing by granting
straight after Uploading v1.

Such a Book can be deleted, and only such a Book. Deletion exists to undo the
create step this decision introduces and nothing else. Once a Version exists the
Book is permanent: a cascade would destroy Reviewers' Threads and Comments, and a
Reviewer's discussion disappearing is a worse outcome than an abandoned row.

## An Upload is confirmed, not immediate

The Author sees a preview before the Upload commits: the Book's name it is about
to land on, the first **twenty segments** of extracted text — ADR-0005's
extraction, run over the sanitised tree — and how many Threads would Unlink.
Plain text in Marginly's own type, with no Book CSS, no iframe and no images, so
the preview depends on nothing about how a Version is rendered.

The name and the segments are the guard against a misclick, and twenty segments
of the wrong manuscript is unmistakable. The Unlink count answers a different
question — not "is this the right file" but "what does landing it cost" — and
ADR-0009 shows it because an Upload has no undo. Withholding it until after
completion, which this decision originally did, told the Author what they had
already spent rather than what they were about to. The count is a projection:
ADR-0009 recomputes it authoritatively inside the Upload transaction, and a
Thread Resolved or started while the Author reads the preview moves it.

After confirmation nothing is removable — no Version deletion, no undo. Removing
the latest Version would have to reverse the `thread_versions` rows the Upload
wrote (ADR-0006) and re-link every Thread it Unlinked, and it collides with
Versions being numbered one past the latest: a deleted v4 makes the next Upload
v4 again, so an old URL shows content it never held.

The staged bundle lives in **its own bucket**, separate from the one holding
Versions, and is deleted on confirmation. An abandoned preview leaves an object
nobody reads, and no sweeper, cron job or lifecycle rule is built for it. The
separate bucket is what makes that safe: any sweeper ever pointed at it cannot
reach a Version.

## Consequences

**An empty Book is a state every Author-facing read must survive.** A Book page,
a dashboard row and a Version list all have a zero-Version case, and the grant
path has a refusal that exists for no other reason. ADR-0011 gives each of them a
shape: the row reads as holding no Versions, and the Book page is itself with an
Upload prompt where the text would be.

**A wrong-file Upload is permanent.** One confirm screen stands between a
misclick and a junk Version whose arrival Unlinks a Book's Threads. The recovery
is to Upload the right file as the next Version and re-link by hand.

**Abandoned staged bundles accumulate**, but ADR-0009 bounds them at one per
Book: a Book holds at most one unconfirmed bundle, and a fresh preview clears the
staging prefix before writing its own. What is left is dead storage counting
against the project's quota for Books whose Author walked away mid-preview.
Supabase Storage offers no object expiry — its S3 endpoint answers neither
`PutBucketLifecycleConfiguration` nor `GetBucketLifecycleConfiguration`, and a
bucket carries no TTL — so clearing them would mean building a sweeper, and none
is built. Around twenty abandoned bundles at the 50 MB ceiling fill a Free-plan
project's 1 GB, and exhaustion refuses further Uploads rather than billing for
them, so the trigger to revisit is a count of Books, not a cost.

**A rename can fail.** Uniqueness makes naming a fallible operation on both
create and rename, so both need the collision path rather than just the create
form.
