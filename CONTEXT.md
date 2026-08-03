# Marginly

Marginly lets an Author share a work-in-progress Book with invited Reviewers,
and lets those Reviewers discuss it in place. The Book keeps changing
underneath the conversation, so the model's central concern is holding
feedback onto text that moves.

## Language

### The work

**Book**:
The durable work an Author shares and Reviewers follow. Persists across every
Publish.
_Avoid_: manuscript, draft, title

**Version**:
An immutable snapshot of a Book's content, created by a Publish.
_Avoid_: edition, revision, release, draft

**Publish**:
The Author's deliberate act of making a new Version visible. Nothing reaches
Reviewers without one. A Version becomes visible only once whole and fully
anchored — Reviewers never see a partially processed Publish.
_Avoid_: upload, push, sync

**Book Source**:
The files an Author actually writes in, held wherever they keep them. Outside
Marginly's boundary — Marginly receives the output of a Publish and never the
source.
_Avoid_: manuscript, repo, original

**Block**:
The smallest addressable unit of rendered content — a paragraph, heading, or
list item. Identified by its own content, never by an id the source supplied.
_Avoid_: paragraph, node, element, chunk

### People

**Author**:
The person who owns a Book and publishes Versions of it.
_Avoid_: writer, owner, creator

**Reviewer**:
A person invited to read a Book and give feedback on it. Never writes to the
text.
_Avoid_: reader, beta reader, collaborator, commenter

### Feedback

**Thread**:
A discussion rooted at one Anchor. Visible to both the Author and the
Reviewers, whatever state its Anchor is in.
_Avoid_: annotation, note, review

**Comment**:
A single message within a Thread.
_Avoid_: reply, remark

**Open** / **Resolved**:
A Thread's lifecycle state. Resolved means the discussion is closed, not that
the text is gone. Independent of the health of the Thread's Anchor — an
Orphaned Thread may still be Open, and an Anchored one may be Resolved. A
Reviewer can always find the Threads they started, in either state.
_Avoid_: closed, done, archived, addressed

### Anchoring

**Anchor**:
The durable pointer from a Thread to a place in the Book: quoted text plus
surrounding context, re-resolved against every Version. Character offsets are
a search hint, never identity.
_Avoid_: selection, highlight, range, position

**Decay**:
An Anchor falling to the tightest level that survived a Publish: range →
Block → section → Book.
_Avoid_: break, fallback, detach

**Drift**:
An Anchor that re-resolved onto changed text. Displayed carrying that warning,
alongside the text originally quoted.
_Avoid_: stale, moved, fuzzy

**Orphan**:
An Anchor whose text is gone entirely. Retains the scope it Decayed to and
stays visible to the Author.
_Avoid_: dangling, lost, resolved

### Change

**Last-seen Version**:
The Version of a Book a given Reviewer most recently opened. Held per Reviewer
per Book.
_Avoid_: bookmark, checkpoint, progress

**Delta**:
The difference between two Versions of a Book — normally a Reviewer's
Last-seen Version and the latest one. Every Delta is between Versions; which
two depends on the Reviewer, so two Reviewers opening the same Book at the
same moment can see different Deltas.
_Avoid_: diff, changes, updates
