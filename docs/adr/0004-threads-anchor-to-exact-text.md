# Threads anchor to exact text and come Unlinked when it changes

ADR-0002 carries an Open Thread into every new Version, so a Thread has to find
its text again in a Book the Author edited offline. A Thread anchors to **the
exact passage a Reviewer selected**, and an Upload re-finds it by exact text
match on whitespace-normalised text. One occurrence links. Several occurrences
resolve to the one sitting inside a paragraph whose own text still matches. No
occurrence — or two indistinguishable candidates — leaves the Thread
**Unlinked**: still Open, still commentable, placed wherever a Reviewer drags it,
and linkable by hand.

Nothing in the uploaded HTML determines a Block. A Reviewer drags across text and
that selection *is* the Block, so neither the file's structure nor any ids it
carries are ever identity.

## Considered Options

**Trusting ids in the uploaded HTML** would have made identity free. It was
rejected because nothing produces them reliably: Pandoc derives heading ids from
heading text and gives paragraphs none, and Word and Google Docs export nothing
stable. It amounts to requiring the Author to run a bespoke pipeline that mints
and preserves per-paragraph ids across offline edits forever, or the carry breaks
in silence.

**Anchoring to a whole structural Block** — a paragraph, a heading, a list item —
was the earlier reading, and it is why `Readme.md` first said a Thread never
anchors to a phrase inside a Block. It was rejected because a Reviewer sees no
markup and should be able to comment on a sentence. It also turns out to be
*worse* on the outcomes that looked hardest: with a text range, a paragraph the
Author split or merged still contains the selected passage verbatim, so split and
merge need no rule at all.

**Fuzzy matching** above a similarity threshold would hold a Thread onto a
reworded passage. It was rejected because it attaches a discussion to text whose
meaning may have moved on, and the threshold is a number nobody can defend. The
accepted cost is that a copy-edit pass over a whole Book Unlinks every Thread in
it at once.

## Consequences

Any edit to the selected text Unlinks the Thread, and a fixed typo counts. The
remedy is deliberately manual, and it works because the system leans on
something it cannot compute: an Author and a Reviewer both remember what a
discussion was about. Fuzzy matching is an attempt to reconstruct that
mechanically; asking the people who already know is cheaper and more accurate.

Unlinking is not sticky. A Thread Unlinked by an Upload keeps its text and is
retried on every later Upload, so a passage cut in v3 and restored in v4
reclaims its discussion for free. A Thread a Reviewer unlinks *deliberately*
discards its text and stays Unlinked until linked by hand — that gesture exists
to correct a wrong link, not to park a Thread.

An anchor stores the selected text and its containing paragraph's text as the
matching inputs, plus the resolved offset as the matching *output* — the offset
is never matched against, it is what the reading view draws the highlight from.

Linking, re-linking and unlinking are mutations, so ADR-0003 confines them to the
latest Version. Every earlier Version keeps the link state it held when the next
Upload arrived, exactly as it keeps its Comment list, so a Thread reads Unlinked
on v3 and linked on v4 when that is what was true.
