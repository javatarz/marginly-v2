# The reading view is a margin rail over drawn coverings

`Readme.md` asks for Threads beside the text, each tied to its Block, with every
commenter's role shown. Three reading views were built to react to. The **margin
rail** wins: a fixed right-hand column of Thread cards, each pinned to the
vertical position of the text its Thread is rooted on and nudged down only far
enough to stop cards overlapping. Marginly is a desktop surface, and a narrow
layout is not a design constraint.

A Block's text is **covered by rectangles drawn over it at read time**, computed
from the Version's stored `text_position` and thrown away on the next paint.
Marginly puts nothing into the Book's markup and never rewrites a Version's
stored HTML. Before drawing, every Linked Thread's range on the Version is merged
into a union interval set and only that union is drawn, so overlap and nesting
leave no trace; selecting a Thread draws that Thread's own range on top of the
union.

Where several Threads share a Block, each gets its own card in the rail, and
clicking the covered text cycles which one is selected. An Unlinked Thread's card
sits in the rail at the position carried from the previous Version, scrolling
with the page, until someone drags it. A hand placement is a request rather than
a coordinate: it says where the card wants to sit, and the same collision nudging
settles it from there. **Two cards never overlap, in any case.** A rail that lets
them overlap reads as a broken interface rather than a precise one, and nobody
dragging a card beside a paragraph wants pixel accuracy from it. Nudging is
downward only, so cards keep the order their positions asked for and a card
dropped between two others lands between them.
Re-linking is that same drag, released over the text: the target is the reader's
selection if they have one, and the sentence under the cursor if they do not.
There is no toolbar.

Starting a Thread is a plain text drag anywhere in the Version, ending in one
affordance at the end of the selection. It is never a per-element control,
because a selection may run across paragraphs (`Readme.md:30`).

A Frozen Version is signalled by **absence** — no composer, no Resolve, no drag —
and by naming the Version on screen without counting the Versions after it. An
earlier Version is a point-in-time view and gives no indication of what followed,
including how much followed. The Version switcher still lists every Version,
because navigating between them is the reader's own act rather than something the
reading surface tells them.

A Book opens on its latest Version. ADR-0002 carries every Open Thread there, so
the latest Version is the only one where the whole live discussion is present.

## Considered Options

**Inline expansion** put no rail on the page: a counted marker sat in the flow at
the end of each covered passage, and opening a Thread pushed the text down to
make room, the way a code review reads. It was rejected on a mechanism, not a
taste. ADR-0006 makes a character range into the extracted text the only thing
that locates a Block, and injecting any element into the Book's markup splits a
text node and invalidates every offset after the injection point. Working around
that means marking Marginly's own nodes as excluded from extraction and rebuilding
the offset index after every injection — a correctness burden carried on every
read, to buy a layout that also moves the reader's place on the page whenever a
discussion is opened.

**A focus overlay** gave the text the whole viewport and opened one Thread at a
time in a popover anchored to the selection, with a full-screen index behind a
corner button. It was rejected because `Readme.md` asks for Threads beside the
text rather than one Thread at a time, and because it hid every Unlinked Thread
inside that index. Re-linking is the one gesture that has to be discoverable
without being taught, and it cannot live behind a button.

**Wrapper spans instead of drawn rectangles** would have made the covering part
of the document and free to keep in place. It is not expressible: `Readme.md:30`
lets selections overlap freely, and arbitrarily overlapping ranges cannot be
written as nested elements.

**One translucent layer per Thread** was the naive way to draw the covering. It
was rejected because overlapping layers compound, so the darkness of a passage
would count the Threads on it — the reading view is required to show no nesting
until a Thread is selected, and this leaks it in the one state that is supposed
to be uniform.

## Consequences

**Every read builds a character-offset to DOM-position index** for the Version on
screen. It has to agree exactly with the extraction rules ADR-0006 stores the
text under; disagree by one character and every covering on the page is drawn in
the wrong place. The extraction rules and the index are one thing implemented
twice, and they are only correct together.

**Coverings are geometry, so nothing holds them in place for free.** They are
redrawn on resize, on a font or zoom change, and whenever a card expands. A
Version's own CSS can move text after first paint, and the covering has to follow.

**A range spanning a figure or a table skips it with no rule.** ADR-0005 leaves
both out of the extracted text, so no character of any range maps inside them.
`Readme.md`'s promise that a selection never covers an image or a table is not a
constraint anyone enforces; it is already true.

**An Unlinked Thread's carried placement drifts.** It is derived from a fraction
of the extracted text, per ADR-0006's requirement that a placement be computable
from a character range, and a fraction of text is not a fraction of page height —
figures and tables take vertical space and contribute no characters. Proximity is
accepted as enough, because the placement exists to be dragged. How the placement
is actually expressed is still open.

**Marginly's interface is drawn over the Book's content, so the two share a
document.** ADR-0005 requires that a Book's CSS never reach Marginly's own
interface, and this decision does not say how that is enforced. Whatever enforces
it also has to keep the offset index and the coverings reachable, which rules out
anything that puts the Book in a document the reading view cannot measure.

**Mobile is a choice not to serve.** The rail's whole idea is alignment to text,
and that has no narrow-screen equivalent — a rail on a phone is an index with
extra steps. Serving a phone later means a second reading view, not a responsive
version of this one.

**No term was added to `CONTEXT.md`.** `CONTEXT.md` names Block, Linked and
Unlinked and avoids "highlight" as a name for a Block, so the drawn covering is
described rather than named. If it earns a word it will be for the rendering, not
for the Block.
