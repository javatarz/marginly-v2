# The Upload preview fits in one Edge invocation, and memory binds before CPU

Measured on 2026-08-13 against the linked Supabase project (`marginly`, Free plan,
`ap-south-1`), for [issue #16](https://github.com/javatarz/marginly-v2/issues/16),
which cannot choose the preview's shape without a number. Issue #15 established the
2 s CPU cap from the documentation and left the parser choice "to a measurement on a
real Book"; ADR-0012 then removed CSS parsing from the preview entirely, so #15's
arithmetic is stale in Marginly's favour.

The prototype is on `prototype/upload-preview-cpu` at
`supabase/functions/prototype-upload-preview-cpu/`, with the War and Peace fixture
committed beside it.

## Answer

**One invocation is enough, with roughly 5× margin on the hardest real Book.** War
and Peace — 3.88 MB of HTML, 11,401 `<p>`, 387 headings — completes the whole
pipeline in **389 ms of CPU** against a 2,000 ms budget. Nothing in a 144-run matrix
across four Books and both parsers returned HTTP 546.

So the third shape #16's framing did not include is the one the measurement supports:
**stage the zip in Storage, run the entire preview in a single synchronous Edge
invocation.** No job representation, no polling surface, no abandonable mid-sequence
state, and no second runtime.

**Use `deno-dom`.** It is faster than `parse5` on every Book measured, and the WASM
instantiation cost #15 flagged as a risk does not materialise.

**But the real ceiling is memory, not CPU, and it is on HTML size rather than bundle
size.** A single 15.5 MB HTML document dies of `WORKER_RESOURCE_LIMIT` while using
under half the CPU budget. This is a new constraint that neither #15 nor ADR-0005
names, and it is the one thing here that #16 should treat as load-bearing.

## What was measured

The pipeline as ADR-0005, ADR-0009 and ADR-0012 specify it: fetch the staged zip,
unzip, hash (SHA-256 over unzipped files in sorted path order, before sanitisation,
`.css` excluded by extension), parse, sanitise against the allowlist walk, then
extract and segment.

Segmentation follows ADR-0005's `## The extracted text` exactly: boundaries at `p`,
`h1`–`h6`, `li`, `blockquote`, `pre`, `figcaption`, `div`; inline elements contribute
text with no space added; `<br>` contributes a space rather than starting a segment;
tables excluded entirely; each segment whitespace-collapsed and trimmed, empties
dropped. As a correctness check, War and Peace yields **11,784 segments** against
11,401 `<p>` plus 387 headings — the two agree to within four segments.

**Open Thread matching is stubbed**, per the handoff's allowance. It is an in-memory
string pass and is not what burns the budget.

Timing is `performance.now()` per stage. The staged-zip download is reported but
**excluded** from the CPU figure, since Supabase's own definition of the cap excludes
async I/O. Section [Is this really CPU time?](#is-this-really-cpu-time) validates the
accounting against the platform's own cliff.

## Per Book, per parser, per stage

Median of 3 runs, milliseconds of CPU, warm isolate. `deno-dom` is
`jsr:@b-fuze/deno-dom@0.1.56`; `parse5` is `npm:parse5@8.0.0`; unzip is
`npm:fflate@0.8.2` for both.

### `deno-dom`

| Book | HTML | unzip | hash | parse | sanitise | extract | **total** | of 2 s |
|---|---|---|---|---|---|---|---|---|
| Alice | 193 KB | 8.7 | 0.6 | 31.4 | 4.7 | 4.5 | **47** | 2% |
| Moby-Dick | 1.47 MB | 32.8 | 1.9 | 130.9 | 13.1 | 24.6 | **213** | 11% |
| **War and Peace** | **3.88 MB** | 47.0 | 4.6 | 271.8 | 29.2 | 55.3 | **389** | **19%** |
| Pride and Prejudice | 853 KB | 306.0 | 27.2 | 108.2 | 19.4 | 19.4 | **502** | 25% |

### `parse5`

| Book | HTML | unzip | hash | parse | sanitise | extract | **total** | of 2 s |
|---|---|---|---|---|---|---|---|---|
| Alice | 193 KB | 8.9 | 0.7 | 50.0 | 0.9 | 6.0 | **76** | 4% |
| Moby-Dick | 1.47 MB | 32.6 | 2.3 | 196.2 | 2.3 | 34.6 | **275** | 14% |
| **War and Peace** | **3.88 MB** | 46.4 | 4.6 | 427.3 | 8.4 | 87.1 | **588** | **29%** |
| Pride and Prejudice | 853 KB | 305.3 | 28.3 | 126.8 | 2.6 | 21.3 | **513** | 26% |

Two things worth reading off these tables.

**Parse dominates, and it scales with markup rather than bytes.** Pride and
Prejudice's bundle is 25.8 MB across 166 files — over half of Storage's 50 MB
ceiling — and its whole preview costs 502 ms, because its HTML is only 853 KB. Its
cost is concentrated in `unzip` (306 ms), which is the only stage that scales with
the bundle. **A 50 MB bundle is not a problem; a large HTML file is.**

**`sanitise` is where the parsers differ in character.** `parse5` sanitises 3.5×
cheaper than `deno-dom` (8.4 ms vs 29.2 ms on War and Peace) because `deno-dom`'s
attribute access goes through its DOM wrapper. `deno-dom` wins anyway, because parse
is the larger term and it parses ~1.6× faster.

## The `deno-dom` versus `parse5` verdict

`deno-dom`, settling #15's loose end.

It is faster on every Book, and the gap widens with document size — 389 ms vs 588 ms
on War and Peace, and 1.0 s vs 1.9 s on a synthetic 11.6 MB document, where `parse5`
comes within 8% of the cap that `deno-dom` clears with half the budget spare.

**#15's WASM instantiation worry does not survive contact.** #15 reasoned that
because an isolate retires after using 50% of any resource, an Upload preview is the
request *least* likely to land warm and should be budgeted as always paying
instantiation. Measured by redeploying to force a cold isolate and invoking once:

| | cold | warm |
|---|---|---|
| `deno-dom`, War and Peace | 448 ms | 551 ms |
| `parse5`, War and Peace | 596 ms | 701 ms |

Cold is not more expensive than warm — the difference is inside run-to-run variance,
and in both cases the cold run happened to be the faster one. Whatever the raw
`.wasm` instantiation costs, it is not visible against a 400–600 ms pipeline. Budget
for it as noise.

**The `.wasm` survives the eszip deploy.** #15 recorded this as undocumented and
needing a probe: Supabase documents `static_files` for a `.wasm` you build yourself
but says nothing about one arriving as a transitive module of a `jsr:` dependency.
The default `jsr:@b-fuze/deno-dom` entrypoint deploys and runs correctly through
`supabase functions deploy`, so the expensive base64 entrypoint is not needed.

The caveats #15 recorded against `deno-dom` are unchanged and are not measurement
questions: version `0.1.56`, a README calling it "still under development", tagged
releases stopped in 2023, and an html5ever pin at 0.25.1. `parse5` remains the
conservative fallback at roughly 1.5× the CPU, which the margin can absorb.

## The real ceiling is memory

This is the finding that was not being looked for.

Synthetic documents were built by repeating War and Peace's `<body>` content N times
in one HTML file, keeping the bundle otherwise identical:

| Fixture | HTML | `deno-dom` | `parse5` |
|---|---|---|---|
| ×1 | 3.88 MB | 389 ms | 588 ms |
| ×2 | 7.75 MB | 678 ms | 1,101 ms |
| ×3 | 11.6 MB | 1,033 ms | 1,993 ms |
| ×4 | 15.5 MB | **546** | **546** |
| ×8 | 31.0 MB | **546** | **546** |

`parse5` at ×3 is genuinely out of CPU — 1,993 ms of a 2,000 ms budget. `deno-dom` at
×4 is not: linear extrapolation puts it near 1.3 s, comfortably inside the cap, and
it dies anyway.

A controlled experiment separates the two limits. Parsing, sanitising and extracting
the *same* 3.88 MB document N times in one invocation grows CPU linearly while peak
memory stays flat, because only one tree is alive at a time:

| | CPU | outcome |
|---|---|---|
| `deno-dom`, W&P ×1 repeated 4 times | 1,521 ms | completes |
| `deno-dom`, single 15.5 MB document | — | **546 at parse** |

**`deno-dom` survives 1,521 ms of CPU across four sequential parses and dies on one
15.5 MB document that needs less.** The difference is not CPU, so it is memory: Supabase documents
`Maximum Memory: 256MB` and #15 recommends planning at 150 MB, against a single tree
whose in-memory size is a large multiple of its 15.5 MB source. The ceiling sits
between 11.6 MB and 15.5 MB of HTML.

`Deno.memoryUsage().rss` returns **0** inside the Edge Runtime, so this is inferred
from the controlled experiment rather than read off a gauge. That is the weaker form
of evidence and is flagged as such — but the CPU explanation is directly excluded by
the row above, and memory is the only other resource `WORKER_RESOURCE_LIMIT` covers.

### What that means for ADR-0005

ADR-0005's `## Size` says there is no application-level ceiling and that Storage's
50 MB is the effective one, then correctly notes processing has its own limit which
"is not a byte count". The measurement half-agrees and half-corrects:

- **The limit is a byte count after all** — just of the HTML, not of the bundle. It
  is roughly **12 MB of HTML**, and it is memory.
- Node complexity drives CPU, and CPU is no longer the binding constraint at any
  document size that fits in memory.
- "A Book can be small enough to store and too heavy to preview" stays true, but the
  case is narrower than feared: a Book needs ~3× War and Peace *in one HTML file* to
  reach it.

Whether that is worth a stated ceiling and a refusal, or is remote enough to leave
alone, is #16's call and not settled here.

## Is this really CPU time?

`performance.now()` measures wall clock. No stage after `download` performs I/O, so
on a single-threaded isolate the two coincide — but the figures are only worth
trusting if they land where the platform's own cliff is.

They do. `parse5` on the ×3 fixture measured **1,993 ms** and returned 200; the same
parser asked for a fourth repetition of War and Peace (~2.4 s projected) returned
546. The accounting is therefore accurate to something on the order of ±10% at the
point where it matters, and the ×3 run is a measured data point 7 ms from the cap
that still succeeded.

Issue #17's caveat about synchronous loops overshooting by up to 3× does not apply
here: this pipeline yields to the event loop between stages, and every stage boundary
is a real yield point.

## Method and reproducing

Deployed, not local — local Deno has no 2 s cap and different hardware.

```
supabase functions deploy prototype-upload-preview-cpu --no-verify-jwt \
  --project-ref <ref>
BOOKS="alice moby-dick war-and-peace pride-and-prejudice" \
  ./supabase/functions/prototype-upload-preview-cpu/run.sh
```

The function takes `{book, zipUrl, parser, upto, repeat}`. `upto` truncates the
pipeline at any stage, which is what makes a 546 survivable as evidence: each stage's
cumulative cost comes from a run that completed, so a failing full run still leaves a
breakdown. `repeat` re-runs parse/sanitise/extract on one document to grow CPU
without growing peak memory.

The corpus is Project Gutenberg "HTML with images" zips — real toolchain output,
public domain, already in Marginly's shape — repackaged so `index.html` sits at the
zip root beside `images/`, and staged in a private `prototype-books` Storage bucket
reached by a short-lived signed URL, so the function holds no secret.

Two environment notes for whoever runs this next. The `SUPABASE_SERVICE_ROLE_KEY`
injected into an Edge Function did **not** authorise a read of a private Storage
bucket (`NoSuchBucket`), which is why a signed URL is passed in instead. And the
Management API log route #17 used needs an access token that lives in the macOS
keychain here, so the shutdown-reason logs the function emits on `beforeunload` were
not retrievable in this session — hence the `repeat` experiment standing in for a
direct memory reading.

**Known gap, accepted in the handoff:** Gutenberg is clean markup. Removed-tag counts
were 9 (Alice), 145 (Moby-Dick), 13 (War and Peace) and 43 (Pride and Prejudice) —
none of Word's `mso-` junk, `o:p` tags or `<font>` soup. That matters for ADR-0005's
render-quality allowlist, which is designed to grow as real exports arrive. It does
not matter for #16, which turns on node count, and Gutenberg supplies that honestly.

## What #16 still has to decide

The measurement removes the reason to split and the reason to leave Edge Functions.
It does not decide:

- Whether ~12 MB of HTML becomes a stated ceiling with a refusal, or an accepted
  remote failure. A preview that dies returns 546 with no partial result, so an
  Author would see a generic failure with nothing actionable in it.
- What the preview's contract with the Author becomes, now that it can be one
  synchronous call again — ADR-0009's single indeterminate loader was written for
  exactly this shape.
- Whether the Unlink count stays in the preview. It was stubbed here, and the
  measurement gives no reason to move it.

Next ADR number is **0014**.
