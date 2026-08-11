# Non-latest Versions show Frozen Threads

Every mutation — adding a Comment, Resolving — happens only on a Book's latest
Version. On any earlier Version a Thread is **Frozen**: it shows exactly the
Comments it held and the state it was in when the next Version arrived,
read-only, with no indication that the discussion continued. v1 keeps its three
Comments permanently; the fourth, written while v2 was the latest Version, never
appears there. A Thread Resolved while v1 was latest reads Resolved on v1; one
created on v2 and Resolved on v5 reads Open on v2, because that is what it was
when v2 froze.

## Considered Options

The alternative was **one live view per Thread** — a Thread renders its full
Comment list identically from whichever Version you are reading. It is cheaper:
no per-Version cut-off on any read path.

It was rejected because reading v1 would then surface Comments written about
v3's text. A Reviewer opening an old Version would find margin notes discussing
sentences that are not on the page in front of them, which makes the old Version
misleading rather than historical.

## Consequences

Every read of a non-latest Version applies a cut-off to the Comment list, so one
Thread renders differently depending on which Version it was opened from. That
is deliberate and should not be "fixed."

An earlier Version is a **sealed record**: it cannot tell you whether a
discussion was answered, continued, or abandoned. The only durable trace of a
resolution is the optional final-note Comment, and it survives into exactly one
Version — the one that was latest when the Author Resolved. This is why the
final note, though optional, is expected in practice.
