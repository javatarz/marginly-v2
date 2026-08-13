# The Upload preview is one synchronous call over a staged zip

The Author's browser sends the zip to the Book's staging prefix in Storage. Then
one Edge Function invocation does the whole preview — unzip, hash, sanitise,
extract, segment — and returns what the Author confirms. There is no job record,
no status to poll, no partial preview to abandon, and no second runtime.

ADR-0009 wrote the preview as one synchronous call and then declared it dead:
issue 15 measured an Edge Function's cap at 2 s of CPU per request, exceeding it
returns HTTP 546 with no partial result, and unzipping up to 50 MB and parsing a
whole document did not look like it fit. Issue 16 was framed on that as a binary —
split the preview across invocations, each with its own 2 s, or move it off Edge
Functions entirely. Both options buy an escape from a cliff. Neither is cheap: the
first needs a job/status representation the design does not have, a polling
surface, and mid-sequence state that can be abandoned; the second needs a third
runtime beside Supabase and Next.js with its own deploy and secrets path.

The cliff is not there. Two things moved after issue 15:

**ADR-0012 removed CSS from the preview.** Issue 15's numbers were taken while
selector scoping and `css-tree` were still in scope. A Version renders in
Marginly's own typography, so the preview parses no stylesheet at all.

**The preview was measured on real Books.** Median of 3 runs, ms of CPU,
`deno-dom`, warm isolate, deployed rather than local. Download excluded, because
Supabase's cap excludes async I/O.

| Book | HTML | unzip | hash | parse | sanitise | extract | total | of 2 s |
|---|---|---|---|---|---|---|---|---|
| Alice | 193 KB | 8.7 | 0.6 | 31.4 | 4.7 | 4.5 | **47** | 2% |
| Moby-Dick | 1.47 MB | 32.8 | 1.9 | 130.9 | 13.1 | 24.6 | **213** | 11% |
| War and Peace | 3.88 MB | 47.0 | 4.6 | 271.8 | 29.2 | 55.3 | **389** | 19% |
| Pride and Prejudice | 853 KB | 306.0 | 27.2 | 108.2 | 19.4 | 19.4 | **502** | 25% |

War and Peace previews in 389 ms against 2,000 ms, in one invocation, at roughly
5× margin. No run in a 144-run matrix across four Books and both parsers returned
a 546. Both of issue 16's options pay a structural cost forever to escape a limit
the preview reaches at a fifth of it.

Issue 17 removed the cheapest of the two. Supabase's own documented pattern —
return an id, work on in `EdgeRuntime.waitUntil`, poll — does not get a fresh
budget: a background task shares the request's 2 s rather than receiving its own.
Moving work after the response changes when the caller hears back, not how much
CPU the work may use.

## The zip goes to Storage first

ADR-0009 had the browser post the zip as the request body. It goes to the Book's
staging prefix instead, and the function receives a path.

This is not about CPU — the measurement excludes transfer either way. It is about
which ceiling is the real one. An Edge Function's request body limit is
undocumented, and ADR-0005 promises the Author 50 MB because that is what Storage
documents. Uploading to Storage makes the documented number the true one, and the
function then reads bytes it can size before it parses them.

The raw zip **stays** under the staging prefix until the confirm clears it. A
preview that fails is retried without re-sending up to 50 MB, which is the same
reasoning ADR-0009 uses for copying rather than moving on the confirm. ADR-0008
already accounts for abandoned staged bundles against the project's quota and
builds no sweeper; this adds the zip beside the unzipped output it already
tolerated.

Everything else about staging is untouched: the prefix is cleared before a new
bundle is written, a Book holds at most one unconfirmed bundle, and a hash
matching the latest Version refuses the Upload outright.

## The HTML has a ceiling, and it is 10 MB

CPU is not what binds first. Memory is, and on the size of `index.html` rather
than the size of the bundle.

| Fixture | HTML | `deno-dom` | `parse5` |
|---|---|---|---|
| ×1 | 3.88 MB | 389 ms | 588 ms |
| ×2 | 7.75 MB | 678 ms | 1,101 ms |
| ×3 | 11.6 MB | 1,033 ms | 1,993 ms |
| ×4 | 15.5 MB | **546** | **546** |

At ×4 `deno-dom` dies where extrapolation puts it near 1.3 s, well inside the cap.
A controlled run separates the two limits: parsing, sanitising and extracting the
*same* 3.88 MB document four times in one invocation keeps only one tree alive at a
time, costs 1,521 ms of CPU, and completes — while one 15.5 MB document needing
less than that returns 546. Not CPU, so memory. Meanwhile Pride and Prejudice's
25.8 MB bundle across 166 files costs 502 ms, because its HTML is only 853 KB. **A
50 MB bundle is not a problem; a large HTML file is.**

So the function checks `index.html`'s uncompressed size after the unzip and before
the parse, and **refuses above 10 MB** with a message naming the limit. It is a
comparison on a buffer already in hand, and it is the difference between an
actionable refusal and a blank 546 — which gives the Author no partial result and
nothing to act on.

10 MB is deliberately below the evidence rather than at it. The real ceiling sits
somewhere between 11.6 MB and 15.5 MB, and that bracket is *inferred*:
`Deno.memoryUsage().rss` returns 0 in the Edge Runtime, so the discriminator is the
repeat experiment above and not a gauge reading, and the shutdown reasons were not
retrievable. A limit stated one notch under a number that demonstrably succeeded is
the honest place to put a ceiling nobody measured directly. If it ever refuses a
real Book, that refusal is itself the measurement this decision does not have.

For scale: a Book needs roughly 3× War and Peace in a single HTML file to reach it.

## The parser is `deno-dom`

Issue 15 left `deno-dom` versus `parse5` open. `deno-dom` is faster on every Book
and the gap widens with document size — 389 ms against 588 ms on War and Peace,
1.0 s against 1.9 s on the 11.6 MB fixture, where `parse5` comes within 8% of the
cap.

Two risks issue 15 raised against it do not survive measurement. WASM
instantiation is not a visible cost: forcing a cold isolate by redeploying gave
448 ms cold against 551 ms warm — cold was *faster*, so the difference is inside
run-to-run variance. And the `.wasm` survives the eszip deploy: the default
`jsr:@b-fuze/deno-dom` entrypoint deploys and runs, so the base64 entrypoint is not
needed. `parse5` remains a fallback at roughly 1.5× the CPU, which the margin
absorbs.

## What the Author sees

The Book's name it is about to land on, and the first twenty segments of extracted
text. That is the whole preview.

Its job is to catch the wrong file, and twenty segments of the wrong manuscript is
unmistakable. Everything else the Upload has to compute belongs after the Author
confirms the file is right.

**The Unlink count is removed.** ADR-0008 put it in the preview to answer "what
does landing this cost" rather than "is this the right file", and ADR-0009 had the
preview match every Open Thread and throw the result away to produce it. Both go.
The preview already gives the Author the chance to cancel, so a second question
answered before the confirm is work done for a decision that is already made — and
ADR-0007's margin is the durable signal regardless, parking every Unlinked Thread
beside the text it used to hold, at the offset ADR-0014 carries. Matching now
happens once, in the confirm, against the Thread set read inside that transaction.

The Author sees **one indeterminate loader** for the whole wait, as ADR-0009 wrote
it. The reasoning survives the measurement: once the bytes have moved, the rest is
389 ms and not worth a second progress state. The transfer is now separable — a
Storage upload has real byte progress — so a determinate bar is available later if
50 MB uploads read as slow in practice. It is not built now.

## Consequences

**Everything from the confirm onward stands as ADR-0009 wrote it.** The copy
before the transaction, the one transaction over the bump and the `versions` insert
and the `thread_versions` rows, `set local role`, the privilege-free role, and the
bump's row lock. Only the half before the Author presses confirm changed.

**There is one matching implementation again.** ADR-0009 warned that the preview's
count and the confirm's rows had to come from the same code or the Author would
approve a number the transaction disagreed with. With no count there is no second
pass and no drift to guard against.

**ADR-0005's `## Size` is now a byte count.** It said the processing limit "is not
a byte count" and that a Book could be small enough to store and too heavy to
preview. Half of that survives, narrower: 50 MB for the zip, 10 MB for the HTML
inside it.

**ADR-0008's preview no longer carries the Unlink count.** Its reversal — the count
was originally withheld until after completion, then moved forward because an
Upload has no undo — is reversed again, and further: the count is not shown after
the confirm either.

**A refusal is a new failure the Author can hit.** Over 10 MB of HTML there is no
preview and no Version, and the Author cannot fix it by re-exporting smaller unless
they split the Book. Nothing in Marginly splits a Book, and nothing here proposes
it.

**The evidence is Project Gutenberg markup.** Removed-tag counts across the corpus
were 9, 145, 13 and 43 — clean HTML, with none of Word's `mso-` junk or `<font>`
soup. That bears on ADR-0005's render-quality allowlist rather than on this
decision, which turns on node count, but the sanitise column is measured against
markup that gives it little to do.

Method, per-stage numbers and the prototype: `docs/research/upload-preview-cpu.md`.
