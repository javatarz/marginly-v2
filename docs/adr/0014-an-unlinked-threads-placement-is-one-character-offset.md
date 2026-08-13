# An Unlinked Thread's placement is one character offset, carried literally

ADR-0006 gave the placement a column and deliberately left it empty:
`thread_position jsonb`, null exactly when a Thread is Linked, with one rule
attached — it must be derivable from a character range, so rendered pixels and DOM
coordinates were already out. Nothing ever defined a shape for that jsonb. ADR-0007
said so outright: how the placement is expressed is still open.

A placement is **one character offset into that Version's stored extracted text** —
the same units as `text_position`'s bounds, a point rather than a range. So
`thread_position` is `int4`, not `jsonb`.

```sql
  text_position   int4range,
  thread_position int4,
```

It resolves to a spot on screen through the character-to-DOM index ADR-0007 already
builds on every read: the offset names a character, the index says where that
character is drawn, and the Thread sits at that height. Within one Version there is
no drift at all — a figure that takes vertical space and contributes no characters
cannot move a placement that was never a share of anything.

## The carry is literal

An Upload that Unlinks a Thread writes the **start** of the previous Version's
`text_position`, because ADR-0007 draws a Thread at the vertical position of the text
it is rooted on and the start is that position. If the previous Version was Unlinked
too, the number is copied **unchanged**, clamped to the new text's length. Nothing is
rescaled.

A hand placement does not outlive its Unlinked run. A Thread dragged on v3 that
re-links by itself on v4 and breaks again on v5 takes v5's placement from v4's
`text_position`; the v3 drag is gone. This is ADR-0006's carry rule as written, and
it is right on the merits too — v4's text position is newer information than a drag
made two Versions ago.

## A drag writes the character nearest the drop

Dragging is the only other writer. Released over text it re-links, per ADR-0007;
released in the margin it writes the offset of the character sitting closest to the
drop height — no snapping to a line or a paragraph start. The Thread may still settle
slightly below where it was released, because it draws at that character's line
height and because ADR-0007's downward nudging separates Threads that would overlap.
That is the promise ADR-0007 already made: a placement is a request rather than a
coordinate.

Where two Threads resolve to the same offset, they settle in creation order, oldest
first, so the order is stable across reads and across readers.

## The placement is shared, and either role may set it

There is one `thread_versions` row per Thread per Version, so there is one placement,
and a drag moves the Thread for everyone reading that Version. A Thread is a shared
object exactly as its Comments are, and per-person placement would need a row per
person per Version — a table ADR-0006 specifically refused, and a new word in
`CONTEXT.md`. It would also break re-linking, which is the same gesture and is
unambiguously shared.

**Both the Author and a Reviewer may drag**, amending ADR-0004's "placed wherever a
Reviewer drags it". After a copy-edit pass the Author is the person who knows where
each rewritten passage went, and ADR-0010 already keys access to a Book rather than to
a role. Dragging is a mutation, so ADR-0003 confines it to the latest Version.

## An Unlinked Thread shows the text it kept

ADR-0004 already stores the selected text and its containing paragraph's text so every
later Upload can retry the match, so displaying the selected text costs no storage and
needs no schema change. It is what tells a reader what to look for when dragging the
Thread onto text to re-link — the one gesture ADR-0007 says must be discoverable
without being taught. Nothing marks the text as missing beyond the Thread being
Unlinked, which is what Unlinked means.

## Considered Options

**A fraction of the extracted text** was what ADR-0007 assumed, and it is the option
this decision rejects. Rescaling by length keeps a Thread roughly mid-document when a
chapter is added at the front, where a literal offset lands it a third of the way in.
But both are wrong — the original passage is at neither point — and rescaling is wrong
in a case the literal number gets right: a Version whose text merely grew by a
paragraph moves every proportional placement in the Book, including Threads nowhere
near the edit. A guess that disturbs untouched Threads costs more than a guess that
holds still.

**An ordinal slot between neighbouring Threads** — "after this Thread, before that
one" — was the third shape the ticket named. It defines a position in terms of things
that move: a neighbour is Resolved and disappears, or Unlinks and stops having a text
position of its own, and a long stretch of Book with no Threads on it offers no slot to
name.

**Anchoring the placement to nearby text** is ADR-0004's exact match one level up. It
fails the same way, and when it fails it needs a placement for the placement.

**Rendered geometry** — a pixel offset or a share of page height — was already ruled
out by ADR-0006, and the reason is worth restating: the Upload that computes and
carries a placement runs on a server with no page in front of it.

**Parking every Unlinked Thread at the top of the margin** was honest about knowing
nothing, and was rejected because proximity is the whole value ADR-0007 assigned to a
carried placement. A Thread that keeps a stale offset still says roughly which part of
the Book the discussion came from.

## Consequences

**Text added above a Thread pushes it nowhere.** This restates ADR-0007's drift
consequence correctly: the Thread stays where its number points while the Book moves
under it, so an inserted chapter can leave a discussion beside text that did not exist
when it happened. Accepted, because ADR-0004 retries the match at every Upload — a
restored passage reclaims its Thread for free — and because the placement exists to be
dragged.

**A shorter Version clamps.** Lose the region a Thread's offset pointed into and the
Thread parks at the end of the text. It looks odd and it is honest; the alternative is
inventing a position the data does not have.

**The character index is now needed in both directions.** ADR-0007 built
character-to-position for drawing. A drag needs position-to-character — hit-testing a
height against the same index. One structure, two lookups, and they must agree.

**`int4` closes the door `jsonb` was holding open.** A structured placement now costs a
migration. That is the point: the carry requirement had already ruled out everything a
structure would have held.

**No new vocabulary, and two undefined words retired.** ADR-0007 used "Thread card"
and "margin rail"; `CONTEXT.md` defined neither. A Thread is a Thread wherever it is
drawn, so "card" is retired in favour of Thread, and "rail" becomes "the margin" —
plain English rather than a coined term. ADR-0007's filename keeps its old slug,
because a filename is an address and closed issues link to it.
