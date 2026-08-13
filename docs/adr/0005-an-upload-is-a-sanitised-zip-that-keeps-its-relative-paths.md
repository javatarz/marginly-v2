# An Upload is a sanitised zip that keeps its relative paths

An Upload is a **zip**. `index.html` at its root is the Version; a zip without
one is refused, and any other `.html` it carries is ignored and not stored. A
corrupt zip is refused too, but malformed HTML is not — an HTML5 parser recovers
rather than fails, so there is no unparseable case to rule on.

The HTML is sanitised against an **allowlist**, and anything outside it is
stripped rather than refused. The Author is told how many tags were removed.

Asset references are **left exactly as the Author wrote them**. The bundle's
files keep their relative paths in storage, and nothing in the stored HTML is
rewritten. ADR-0012 rewrites them at read time instead — see below.

## The allowlist

Two halves of one list, doing different jobs.

The security-critical half is fixed and ships from the first Upload: `script`,
`iframe`, `object`, `embed`, `form` and its inputs, every `on*` attribute,
`javascript:` and non-image `data:` URLs, and inline `style` attributes are gone
unconditionally. Marginly serves the Author's HTML on its own origin inside a
Reviewer's session, so a surviving `script` tag is stored XSS against every Book
that Reviewer can read — and the HTML comes from a Word or Pandoc export nobody
audited.

The render-quality half — whether `table`, `sup`, `figure` or Word's `o:p` junk
survives — only decides whether a Version looks right. It grows as real exports
arrive.

Stripping rather than refusing is what makes the two halves separable. The Author
edits offline, so refusing an Upload over an unrecognised tag hands them a
problem they cannot fix at the source. The cost is that a Version can differ from
the file on the Author's disk, which is why the removal count is reported back
rather than left silent.

## The CSS

**Retired by ADR-0012.** This section specified selector scoping, an `@import`
drop, `position: fixed` and `position: sticky` drops, and an allowance for
`url()` and `@font-face`. All of it existed to make an Author's stylesheet safe
to render alongside Marginly's own interface. ADR-0012 renders no Author
stylesheet at all, from any route: a `.css` file in the zip is accepted and then
dropped, `<style>` and `<link>` are removed, and the inline `style` attribute
stays removed by the security half of the allowlist above. `class` and `id`
survive as markup, defining nothing.

The rule this section was written to deliver — nothing in a Book's CSS reaches
Marginly's own interface — holds by there being no Book CSS.

## Assets and how they resolve

Keeping relative paths in storage means no rewrite pass at Upload, but it moves a
constraint onto the reading view. A browser resolves `images/fig1.png` against
the **document's** URL, and this ADR discharged that by serving the Version as its
own document at a trailing-slash path — a Version at `/books/42/versions/3` would
have resolved assets to `/books/42/images/fig1.png` and broken every image in the
Book.

**ADR-0012 retires that trailing-slash invariant.** With no iframe the Book is a
fragment of the reading view rather than a document of its own, and ADR-0011 fixes
a Book at one address with no Version in it, so there is no URL left for a
relative path to resolve against. `src`, `srcset` and `<picture>` are rewritten
onto the access-checked route **at read time**, as the page is assembled. Storage
still holds exactly what the Author sent.

The bucket is private, because a Reviewer reads only the Books they were granted.
An application route mediates every asset request and checks access; "stored
alongside the HTML" is true of storage, not of serving.

An asset referenced but absent from the bundle renders a message saying it cannot
be rendered. An off-site image is fetched per read.

## Deduplication

An Upload is hashed — SHA-256 over the unzipped files in sorted path order,
**before** sanitisation — and compared against the latest Version only. On a
match no Version is created and the Author is told.

Hashing the zip's own bytes would not work: re-zipping an unchanged folder
produces different bytes every time, through embedded timestamps, file ordering
and compression level. It would catch a double-clicked Upload and miss a
re-export of unchanged content, which is the case that actually happens.

Hashing after sanitisation would not work either, because the allowlist grows.
Every addition to it would silently shift the canonical form, and a genuine
duplicate would read as different. The raw extracted files are stable forever.

Comparing against the latest Version alone is deliberate. A Version identical to
some older one means the Author reverted, and the Book genuinely moved.

**ADR-0012 excludes stylesheets from the hash.** Nothing in a `.css` file can
change what a Version renders, so an Author who tweaks only their styling and
re-uploads must get no Version rather than one that reads exactly like the last —
which would also re-match every Open Thread for nothing. Excluding by extension is
a fixed rule, not a growing allowlist, so it does not reintroduce the drift the
section above rejects.

## The extracted text

ADR-0004 anchors a Thread to whitespace-normalised text, which makes extraction
load-bearing for whether a Thread survives an Upload. It runs over the
**sanitised** tree, never the raw upload — otherwise stripping an element would
silently change what every Thread matches against.

Entities are decoded first, so `&nbsp;` becomes a space that normalises away and
`&amp;` becomes `&`; matching against the entity spelling would break on a
re-export that changed nothing visible.

Segment boundaries are `p`, `h1`–`h6`, `li`, `blockquote`, `pre`, `figcaption`
and `div`. Inline elements contribute their text with no space added, so
`wo<em>nd</em>er` extracts as `wonder`. Each segment is whitespace-collapsed and
trimmed, empty segments are dropped, and segments join with a single space.

`<br>` contributes a space rather than starting a segment. It reads like a
boundary — a poem's lines are lines to the Reviewer who selected them — but it
loses on the one thing segments are for. A segment is the "containing paragraph"
that ADR-0004 uses to break a tie when the selected text occurs several times. As
a boundary, every line of a repeated refrain becomes an identical segment, all
candidates are indistinguishable, and the Thread Unlinks. As a space, each
refrain sits inside a different stanza and the tie resolves.

Tables are excluded from the extracted text entirely. `Readme.md` says a
selection never covers a table, and leaving table text out of the extraction
makes that rule enforce itself rather than needing a guard in the selection
interface.

`figcaption` is included and selectable. A caption is prose an Author wrote and a
Reviewer may have a note on it. Excluding it would make some captions selectable
and others not depending on whether the export tool emitted `figcaption` or a
plain `p` — a distinction the Reviewer, who never sees markup, could not predict.

## Size

There is no application-level ceiling. Supabase Storage's global file size limit
applies, which caps at 50 MB on the Free plan, so that is the effective ceiling
until someone raises it deliberately.

That is the ceiling on **storing** a bundle. Processing one has its own, and
**ADR-0014 makes it a byte count after all** — on `index.html` rather than on the
zip. The preview refuses HTML above **10 MB**, because memory, not the 2 s of CPU
an Edge Function gets, is what binds first. A 50 MB bundle across hundreds of
files previews comfortably; one very large HTML file does not. So a Book can still
be small enough to store and too heavy to preview, but the line is now a stated
number the Author is told, rather than a function of how complex their markup is.

## Consequences

**Immutability is weaker than it looks.** ADR-0003 leans on a Version being
immutable so a Frozen Thread shows exactly what it held. That holds for the HTML
and for bundled assets, but not for off-site images: the Author's server can
replace one, and a Version renders differently than it did when the Thread beside
it was written. The Author owns URL stability, and the platform cannot enforce
it. An `http://` reference will be blocked by the browser as mixed content
regardless, so only `https://` renders at all. ADR-0012 adds a second way an old
Version can look different — a change to Marginly's own typography restyles every
Version at once.

**Every Reviewer's read of an off-site resource reaches a third-party server**,
carrying their address and the time they read. For an unpublished Book under
private review, that discloses who is reading and when. ADR-0012 narrows this to
images alone: off-site fonts and `@import`ed stylesheets no longer exist.

**A growing allowlist changes old Versions.** Sanitisation runs at Upload, so a
tag added to the list later does not restore it to a Version already stored. The
Version keeps what it was sanitised to.
