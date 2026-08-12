# Marginly

Marginly lets an Author share a Book with invited Reviewers and lets those
Reviewers discuss it in place. The Book is written and edited outside the
platform; Marginly receives finished HTML and never the source.

## Language

### The work

**Book**:
The durable work an Author shares with Reviewers. Persists across every Version.
_Avoid_: manuscript, title, draft

**Version**:
An immutable snapshot of a Book's content, created by an Upload.
_Avoid_: edition, revision, release

**Upload**:
The Author's act of sending a Book's HTML to the platform, as a zip holding one
`index.html` with its CSS and images. The only way content enters Marginly, and
each one creates a Version unless its content is identical to the latest.
_Avoid_: publish, push, sync, import

### People

**Author**:
The person who owns a Book and Uploads Versions of it.
_Avoid_: writer, owner, creator

**Reviewer**:
A person granted access to read a Book and give feedback on it. Never writes to
the text.
_Avoid_: reader, beta reader, beta user, commenter

### Feedback

**Block**:
The passage of a Version's text a Thread is rooted on, fixed by the Reviewer's
selection when they start it. Nothing in the uploaded file marks it out, and a
Reviewer never sees the file's structure.
_Avoid_: paragraph, node, element, chunk, selection, range, highlight

**Thread**:
A discussion rooted on one Block. Started only on a Book's latest Version.
_Avoid_: annotation, note, review, comment

**Comment**:
A single message within a Thread. Added by an Author or a Reviewer, and only
while the Thread's Book is on its latest Version.
_Avoid_: reply, remark, note

**Open** / **Resolved**:
A Thread's lifecycle state. Only the Author Resolves, and a Resolved Thread is
never reopened — raising the point again means a new Thread. An Open Thread is
carried into each new Version; Resolving it ends that carry.
_Avoid_: closed, done, archived, addressed

**Linked** / **Unlinked**:
Whether a Thread currently has a Block. Orthogonal to Open and Resolved — an
Open Thread may be either — and only an Unlinked Thread is placed by hand.
_Avoid_: orphaned, detached, dangling, floating, lost

**Frozen**:
A Thread as it appears on a Version that is no longer the latest: exactly the
Comments it held and the state it was in when the next Version arrived,
read-only, with no indication of what followed. A Frozen Thread never changes
and accepts no Comments.
_Avoid_: historical, archived, snapshot, locked
