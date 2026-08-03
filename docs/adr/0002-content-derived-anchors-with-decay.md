# Content-derived Anchors with a decay ladder

An Anchor stores the quoted text plus a window of surrounding context, and is
re-resolved against the Book on every Publish. Character offsets are a search
hint only, never identity — they are recomputed from wherever the quote is
actually found. When the quote no longer matches, the Anchor Decays to the
tightest surviving scope: range → Block → section → Book.

## Consequences

The naive alternative — storing offsets as identity — silently misplaces
comments whenever text earlier in a Block is edited, and looks correct while
doing it. That failure mode is unacceptable here, so re-resolution is
mandatory on every Publish and is the reason a Version cannot go visible
until it completes (see ADR-0005).

A partial match re-attaches but is marked as Drift and displayed alongside the
text originally quoted, so a Reviewer is never quietly shown a Thread about
words that no longer exist. An Anchor whose text is gone becomes an Orphan and
stays visible at its decayed scope rather than disappearing.

Anchor health is independent of Thread lifecycle: an Orphaned Thread can be
Open, and a cleanly Anchored one can be Resolved.

This is essentially the W3C Web Annotation selector model, which exists
precisely for annotating documents that change underneath the annotations.
