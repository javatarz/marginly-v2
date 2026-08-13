# A Version renders in Marginly's own typography

No styling written by an Author ever reaches the page. Marginly ships one
typography and every Book in every Version renders in it.

This started as a question about a wall. ADR-0005 requires that a Book's CSS
never reach Marginly's own interface; ADR-0007 draws that interface *over* the
Book's content and measures Highlights against the text's own client rectangles,
so the two have to share a coordinate space; ADR-0011 then widened what is being
protected from Thread cards to Upload, rename, People, delete and revoke. A
stylesheet reaching a Thread card is ugly. A stylesheet reaching a revoke is a
correctness problem.

Every wall was expensive, and each one bought isolation for something whose value
was never established. So the CSS goes instead, and the wall is never built.

## Where CSS is removed

Four routes, closed in four places.

A `.css` file in the zip is accepted and then dropped: not stored, not served.
The Upload does not fail over it, because the Author exports offline and their
tool emits the stylesheet whether they want it or not — refusing would hand them
a problem they cannot fix at the source.

A `<style>` block is removed, and so is `<link>`. They are HTML tags carrying CSS,
and the rule is about the CSS. Leaving them would undo the decision entirely: an
Author whose stylesheet is dropped moves it inline and gets their design back,
inside the same document as the header bar with nothing between them.

An inline `style` attribute was already removed unconditionally by ADR-0005, for
a different reason, and stays removed.

The Author is **not** told, per Upload, that any of this happened. It is not an
event — it is what Marginly is, the same on every Upload of every Book, and
`Readme.md` says so once. This is deliberately unlike ADR-0005's count of removed
tags, which varies per zip and therefore has to be reported per zip.

## What survives

Everything else in the HTML, beyond ADR-0005's security strip.

`class` and `id` stay. They define nothing now, which is exactly why they are
harmless, and `id` is load-bearing: a Pandoc export links a footnote marker to its
footnote by `id`, and a footnote is prose the Author wrote. Stripping `id` would
break every footnote in every Book to save a few bytes.

Presentational attributes stay too — `align`, `bgcolor`, `<font>`, `<center>`,
`width` and `height` on an image. The line is drawn at CSS, not at "styling",
because that line can be stated in one sentence and the other cannot. The cost is
recorded below.

Images render. An image is content the Author wrote; CSS is presentation.

`<mark>` survives as a tag but Marginly draws it **underlined**, never shaded.
Shading over text means one thing in Marginly — a Thread is rooted here — and a
Reviewer who sees the Author's yellow would hunt the rail for a card that is not
there. The word itself is never lost, only the way it is drawn. The equivalent
collision through `bgcolor` does not arise: ADR-0005 leaves table text out of the
extraction entirely, so no character of any Highlight can land inside a table.

The Book's `<html>`, `<head>` and `<body>` do not survive. The Book is a fragment
of Marginly's page rather than a page of its own, which is what sharing one
document means, and a document has one `<body>`. This also closes the last route
in: `<body bgcolor="black">` would otherwise repaint the whole of Marginly,
header bar included, with no CSS involved anywhere.

## The house typography

Serif, a measured reading width, generous leading — typography chosen for reading
long prose, because that is the only job it has. These are manuscripts under
review, and Marginly is now committing to how all of them look.

Semantic HTML carries what is left of the Author's intent, and browsers already
style it: a heading looks like a heading, `<em>` is italic, `<pre>` is monospace,
`<blockquote>` is indented. ADR-0005's render-quality half of the allowlist keeps
growing as real exports arrive, unchanged — it is now the Author's only channel,
which is a reason to keep taking it seriously and not a reason to guess at it in
advance.

## Isolation, and the absence of it

There is no iframe, no shadow root and no selector scoping. Marginly's interface
and the Book's content sit in one document, which is what ADR-0007 wanted all
along: a client rectangle, a text selection and a character-offset index are all
ordinary same-document work, with nothing to reach across.

## Asset paths

ADR-0005 avoided rewriting asset references with a trick: serve the Version as its
own document at a trailing-slash URL, and `images/fig1.png` resolves by itself
onto the access-checked route under it. That trick needs the Book to be a document
at a URL of its own, and it no longer is — it is a fragment inside the reading
view, which ADR-0011 fixes at one address per Book with no Version in it.
`images/fig1.png` would resolve against `/books/` and every image in every Book
would break.

So a rewrite is forced, and it happens **at read time**, as the page is
assembled. The stored HTML keeps matching the zip the Author sent, so ADR-0005's
rule that nothing is rewritten survives where it was actually load-bearing — in
storage — and the URL shape stays changeable, because no Version has one baked
into it. The reading view is already assembling a page out of the stored HTML on
every read, so this is one more pass somewhere a pass already happens. It must
cover `srcset` and `<picture>` as well as `src`, and it repeats on every read.
The trailing-slash invariant ADR-0005 declared is retired: nothing depends on it
any more.

## Considered Options

**An iframe** was the obvious answer and the awkward one. It isolates completely,
it is same-origin so the reading view can still reach in and measure, and it fits
ADR-0005's asset story so neatly that the trailing-slash invariant was written for
it. Against it: every client rectangle, every selection and every drag crosses a
document boundary; the Highlight overlay lives outside and has to be offset
against the frame's box; the frame's height has to be kept in step with content
that reflows as images load; and a card dragged from the rail onto text has to
hit-test into another document. All of that is buildable. None of it is worth
building to contain a stylesheet nobody renders.

**A shadow root** encapsulates without a second document, and is cheaper than an
iframe on every count above but one. Selection is that one. A selection made
inside a shadow tree is not uniformly reachable — `getSelection` answers
differently across browsers and the composed-range API that fixes it is recent —
and ADR-0007's entire interaction model is selection-driven: starting a Thread is
a text drag, and re-linking is a drag released over a selection.

**Selector scoping**, which is what ADR-0005 actually specified, keeps one
document and needs no new machinery. It was rejected on two counts. It is
best-effort against an open set: ADR-0005 strips unknown constructs rather than
refusing them, so the rules arriving are never closed, and after ADR-0011 one
escaping rule reaches delete and revoke. And it cannot scope a media query at all
— a Book's `@media (max-width: 800px)` fires on the browser window, which
includes the Thread rail the Book cannot see, so a Book laid out for an 800px page
picks its wide layout inside a narrower column and the Author has no way to learn
why.

**A small allowlist of safe properties** — alignment, emphasis, indentation, and
nothing else — would have saved the things a Word or Pandoc export leans on. It
was rejected because it is still a wall: it needs a CSS parser, it needs a list
that grows, and a list that grows is the same open set that sank selector
scoping, only smaller.

## Consequences

**ADR-0005's `## The CSS` section is retired whole.** Selector scoping, the
`@import` drop, the `position: fixed` and `sticky` drops and the `url()` and
`@font-face` allowance all existed to make a stylesheet safe to render. Nothing
renders one.

**The preview stops parsing CSS.** Issue 15 found the binding constraint on a
preview to be 2 s of CPU per Edge Function request and named `css-tree` as the
CSS parser needed to serve ADR-0005's rules. That dependency and its share of the
budget are gone. The HTML parser choice issue 15 left open is untouched, and issue
16's decision about the preview's shape now has more headroom than its numbers
assume.

**Third-party fetches narrow to images.** ADR-0005 recorded that every Reviewer's
read of an off-site resource discloses who is reading and when. Off-site fonts and
`@import`ed stylesheets are gone, so an off-site image is the only remaining
disclosure — and the only remaining way a stored Version can drift, which narrows
ADR-0005's immutability consequence to the same case.

**Extraction and render can no longer disagree.** An Author's CSS could previously
`display: none` a passage that extraction still captured, so a Highlight could be
anchored to characters that render nowhere and ADR-0007's offset-to-DOM index
would place it against nothing. That state is now unrepresentable.

**ADR-0007's reflow consequence shrinks to images.** It recorded that a Version's
own CSS can move text after first paint and the shading has to follow. Web fonts
and stylesheets are gone, so only image loading reflows the page, and the `width`
and `height` attributes survive to blunt even that. Redraw on resize, zoom and
card expansion is unchanged.

**Marginly now owns how every Version looks, including Frozen ones.** A change to
the house typography restyles every Version of every Book at once. ADR-0003 leans
on a Version being immutable so a Frozen Thread shows exactly what it held; the
words and the markup still do, but the page a Reviewer saw when they wrote a
Comment is now something Marginly can change afterwards. This is the first thing
in the system that can make an old Version look different from when its Threads
were written.

**A Book that depends on layout reads flatter.** Verse indentation, drop caps,
scene breaks expressed as spacing, small caps — anything an export tool put in CSS
rather than in tags is gone, and the Author is not told which of their choices
survived. Semantics survive; presentation does not.

**The Author keeps a sliver of arbitrary control through old HTML attributes.**
`align="center"` works and `text-align: center` does not, and the Author cannot
tell which of the two their export tool emitted. This is accepted as the price of
a rule that fits in a sentence.
