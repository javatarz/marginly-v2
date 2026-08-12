# Supabase Edge Functions: the real limits on parsing a 50 MB Upload

Research for [issue #15](https://github.com/javatarz/marginly-v2/issues/15), against
Supabase's own documentation and source repositories, Deno's documentation, and the
source or registry metadata of every library recommended below. Every claim carries
the URL it came from. Where Supabase's material does not answer a question, that is
said explicitly rather than filled in with a guess.

This file sits at `docs/research/supabase-edge-function-limits.md`, beside
`docs/research/supabase-auth.md`, following the convention that note established.

Checked 2026-08-12. Two figures below are dated in Supabase's own docs and are
flagged where they appear.

## Summary

ADR-0009 assumed the constraint worth checking was size — the request body limit, and
memory. Neither is the one that binds.

**There is no documented request body size limit for an Edge Function.** Not a large
one; none. Supabase published a figure once and then withdrew it: a Supabase member
answered "Max Request: 5GB", a PR added it to the limits page, and the Edge Functions
lead reverted that PR with "These req/res limits are not accurate for Edge Functions.
Reverting it for now, will update with new limits later"
([PR #30132](https://github.com/supabase/supabase/pull/30132)). Twenty-two months
later the limits page still has no request limit on it. So ADR-0009's worry — that the
function's body limit is below 50 MB and silently caps a Book — cannot be confirmed or
refuted from Supabase's documentation, and the question is close to moot, because the
ceiling on a Book is not a byte count.

**The binding constraint is CPU time: 2 seconds per request.** It is documented
separately from and far more tightly than the wall clock, exactly as the ticket
suspected, and no plan raises it — Supabase gives one number with no plan split, in
contrast to the wall clock, which does split. Unzipping up to 50 MB, hashing it,
building an HTML5 tree over the whole document, walking it to sanitise, parsing and
rewriting the CSS, then extracting and segmenting the text, is precisely the "CPU
intensive" profile Supabase's own troubleshooting page tells you to move off the
platform. Exceeding it returns **HTTP 546** with no partial result.

**Memory is survivable, and Supabase documents how.** The limit is per isolate and an
isolate serves one request at a time, so it is per-invocation in effect — though
Supabase states it as three different numbers across three pages (256 MB, 250 MB and
150 MB). More usefully, Edge Functions have a writable `/tmp` with 256 MB on Free and
512 MB on paid plans, and the documentation's *own worked example* for it is streaming
a zip request body to `/tmp` and unzipping it in a background task, with the explicit
warning that holding the archive in memory instead "will run into memory limit errors
with zip files exceeding 100MB"
([File Storage](https://supabase.com/docs/guides/functions/ephemeral-storage)). That
example is very nearly Marginly's Upload preview.

But it does not rescue the synchronous preview, because **background tasks are capped by
the same CPU limit** ("The maximum duration is capped based on the wall-clock, CPU, and
memory limits", [Background Tasks](https://supabase.com/docs/guides/functions/background-tasks)),
and because returning an id and polling is no longer synchronous. Whether a background
task's CPU is billed against the same 2 s as the request that spawned it, or gets a
fresh budget, is **not documented** — and it is the single most valuable thing to
measure, because it decides between two quite different designs. See open questions.

**The parser and sanitiser exist, with one substitution.** A genuinely spec-compliant,
error-recovering HTML5 tree builder is available two ways —
`jsr:@b-fuze/deno-dom` (html5ever, compiled to WASM) and `npm:parse5@8` (pure ESM, one
dependency) — and `npm:css-tree@3` gives a real, error-tolerant CSS AST whose selector
parsing nests into `:has()`, which is what scoping selectors and dropping `@import`,
`position: fixed` and `position: sticky` needs. Deno has no built-in HTML `DOMParser` and
the runtime exposes no Cloudflare-style `HTMLRewriter`, so a third-party parser is the only
route. What is *not* available is DOMPurify in a configuration its maintainers endorse: it
requires a real DOM, names jsdom as the one to use, and warns that other implementations
"will likely lead to XSS" — and jsdom cannot run here, because it requires `node:vm` and
Supabase states the Node `vm` API is not available. ADR-0005's allowlist is fixed and small,
so a hand-rolled allowlist pass over the parsed tree is the substitution, and the tree has
to be walked for text extraction anyway.

The published throughput figures sharpen the CPU problem without settling it. deno-dom's own
benchmark puts its WASM parser at roughly 32 MB of HTML per second, excluding WASM
instantiation, on 2021-era Deno and laptop hardware. That is fast enough that parsing a
typical export is not by itself the problem — the problem is the sum of inflate, hash, parse,
two tree walks, serialise and CSS rewrite against one 2 s ration, and the fact that inflate
and hash scale with the whole 50 MB rather than with the markup.

**Verdict: ADR-0009's synchronous preview does not survive.** Section 10 says what is
ruled out and what the smallest change is.

## 1. The request body size limit

### What the limits page says, in full

The Edge Functions limits page is short enough to reproduce, and it is the primary
source for everything in sections 1 to 5. Verbatim from
[`apps/docs/content/guides/functions/limits.mdx`](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/functions/limits.mdx):

```
## Runtime limits

- Maximum Memory: 256MB
- Maximum Duration (Wall clock limit):
  This is the duration an Edge Function worker will stay active. During this period, a worker can serve multiple requests or process background tasks.
  - Free plan: 150s
  - Paid plans: 400s
- Maximum CPU Time: 2s (Amount of actual time spent on the CPU per request - does not include async I/O.)
- Request idle timeout: 150s (If an Edge Function doesn't send a response before the timeout, 504 Gateway Timeout will be returned)

## Platform limits

- Maximum Function Size: 20MB (bundled locally via the CLI) or 5MB (bundled server-side, e.g. via the Management API or Dashboard)
- Maximum no. of Functions per project:
  - Free: 100
  - Pro: 500
  - Team: 1000
  - Enterprise: Unlimited
- Maximum log message length: 10,000 characters
- Log event threshold: 100 events per 10 seconds
- Recursive/Nested Function Calling: ~5000 requests per minute
```

([Limits](https://supabase.com/docs/guides/functions/limits))

**There is no request body size limit on that page, and none anywhere else in
Supabase's Edge Functions documentation.** That is the finding, stated plainly because
the ticket asks for it to be.

### The 5 GB figure, and why it is not usable

The absence is not an oversight nobody noticed. It was reported, answered, documented
and then un-documented.

In July 2024 a user opened
[supabase/supabase#28053](https://github.com/supabase/supabase/issues/28053), "Include
request/response size limits in Edge Functions docs", noting that Firebase documents
"32MB as the request/response (non-streaming) size limit" and that "The documentation
doesn't include information on the request and response size limit. This is important
for our use-case, since some users might need to send big payloads."

A Supabase member replied:

> Thanks for opening!
>
> Confirming with the team that the limits are:
> Max Request: 5GB
> Max Response: No limit
>
> Anyone feel free to open a PR for this or I will later in the week

([comment by `encima` (MEMBER), 2024-07-18](https://github.com/supabase/supabase/issues/28053#issuecomment-2236515953))

[PR #28076](https://github.com/supabase/supabase/pull/28076) duly added two lines to
`limits.mdx` — `- Max Request: 5GB` and `- Max Response: No limit` — and was merged on
2024-07-19.

On 2024-10-28 it was reverted by `laktek`, who maintains Edge Functions, with this as
the entire PR body:

> These req/res limits are not accurate for Edge Functions. Reverting it for now, will
> update with new limits later.

([PR #30132, merged](https://github.com/supabase/supabase/pull/30132))

The promised update has not landed. The commit history of `limits.mdx` shows every
change since — websockets, platform limits, static-file warnings, secret limits,
recursive calls, and on 2026-07-15 a clarification of deployment sizes — and none of
them restores a request or response limit
([commit history for `limits.mdx`](https://github.com/supabase/supabase/commits/master/apps/docs/content/guides/functions/limits.mdx)).

So 5 GB is not a number to design against. It was stated by a Supabase employee, and
then disowned by the team that owns the runtime. Treat the limit as unknown.

### What *is* documented nearby

- **Method allowlist.** "Edge Functions only support: `GET`, `POST`, `PUT`, `PATCH`,
  `DELETE`, and `OPTIONS`", and anything else returns 405
  ([Status codes](https://supabase.com/docs/guides/functions/status-codes)). `POST` of a
  zip is fine.
- **No documented 413.** The status-codes page enumerates 401, 404, 405, 500, 503, 504
  and 546. There is no "request entity too large" case listed
  ([Status codes](https://supabase.com/docs/guides/functions/status-codes)). A discussion
  titled "Edge Functions: request entity too large" turns out to be about the *deployment
  bundle*, not a request — the maintainer's answer is "We currently do have a max limit
  for Edge Functions of 10MB", referring to function size
  ([Discussion #20864](https://github.com/orgs/supabase/discussions/20864)); that figure
  is itself now stale against the 20 MB / 5 MB on the limits page.
- **Supabase Storage's limit, which is a different limit.** The global file size limit
  "sets the maximum file size across all your buckets", with a maximum of **50 MB on
  Free**, **500 GB on Pro and Team**, and a custom figure on Enterprise
  ([Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)).
  A per-bucket limit may be lower but "can't be higher than this global limit."

**Bearing on ADR-0005.** ADR-0005's Size section says Storage's global file size limit
"caps at 50 MB on the Free plan, so that is the effective ceiling until someone raises
it deliberately." That sentence is accurate about Storage and remains the right ceiling
for anything that lands in a bucket. What is wrong is ADR-0009's Consequences claim
that "the function's own body limit, not Supabase Storage's, becomes the ceiling on how
large a Book can be" — there is no documented function body limit for it to become. The
amendment ADR-0005 needs is not a smaller number. It is that the ceiling is not a byte
limit at all: it is the CPU budget in section 3, which is a function of how much markup
the document holds, not how many bytes the zip is.

## 2. Memory

### The number, three times

| Page | Figure |
| --- | --- |
| [Limits](https://supabase.com/docs/guides/functions/limits) | "Maximum Memory: 256MB" |
| [546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response) | Memory: `250MB` |
| [Handling Gzip compressed requests](https://supabase.com/docs/guides/functions/compression) | "Edge functions have a runtime memory limit of 150MB." |

Supabase does not reconcile these anywhere. The 150 MB figure appears in prose on a
guide page rather than in a limits table, and is the odd one out by a wide margin; the
256/250 MB gap looks like rounding. Nothing in the docs says which is authoritative.
For planning, 150 MB is the only safe assumption, since it is the smallest figure
Supabase itself has published and it appears on the page that discusses exactly this
scenario — a compressed request body being expanded in memory.

### It is per-invocation, in effect

The 546 page states the isolate model:

> Edge functions run in transient servers called **isolates**. Each isolate:
>
> - Handles one request at a time
> - Is bound to a single function (e.g. an isolate for `func_one` will never serve `func_two`)
>
> When a request arrives, the runtime assigns it to a free isolate or spins up a new one
> if all existing isolates are busy. Each isolate also has resource limitations.

([546 - WORKER_RESOURCE_LIMIT Exceeded](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response))

The limit is therefore stated per isolate, and because an isolate handles one request
at a time, one request has the whole allowance. It is not a pool shared across
concurrent requests to the same function. Note the qualification though: an isolate may
serve *several sequential* requests within its wall-clock lifetime, so memory that is
not released is memory the next request on that isolate does not get. Which brings in
the retirement rule:

> Once an isolate uses 50% of any resource, it will finish the current request and then
> shut down.
>
> However, if that remaining request exhausts all CPU or memory before completion, the
> isolate will terminate immediately and return a 546 response.

([same page](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response))

Read carefully, this does not halve a single request's budget — the current request is
allowed to finish and may use the full allowance. What it costs is isolate reuse: a
heavy request retires its isolate, so the next Upload pays a cold start. For Marginly
that is a latency note, not a correctness one.

### Failure shape

The shutdown reason is `Memory`, whose `ShutdownEvent` "includes detailed memory data
showing total memory, heap usage, and external allocations", and whose documented cause
is that the function "is consuming too much RAM. This commonly happens when buffering
large files, loading entire datasets into memory, or creating many objects without
cleanup"
([Shutdown reasons](https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained)).
The remedy listed first is "Use streaming instead of buffering entire files or
responses". In the logs it surfaces as `Memory limit exceeded`, and to the caller as
546 with:

```json
{
  "code": "WORKER_RESOURCE_LIMIT",
  "message": "Function failed due to not having enough compute resources (please check logs)"
}
```

([546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response))

### Configurability

Not configurable on the hosted platform — nothing in the docs offers a knob, and the
546 page's last remedy is to leave: "Edge functions have a hard resource limit. If your
work requires more resources than we permit, you can look into other solutions, such as
AWS Lambda, that are less restrictive, or self-host edge functions and reconfigure the
settings"
([546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response)).
Self-hosted, limits are explicitly parameters: the runtime's README notes that for the
user runtime "Limits are required to be set such as: Memory and Timeouts"
([supabase/edge-runtime README](https://github.com/supabase/edge-runtime/blob/main/README.md)).

## 3. CPU time — the constraint that decides this ticket

### The number

"Maximum CPU Time: 2s (Amount of actual time spent on the CPU per request - does not
include async I/O.)"
([Limits](https://supabase.com/docs/guides/functions/limits)).

Restated in milliseconds on the shutdown-reasons page, under reason `CPUTime`:

> **What it means:** The worker consumed more CPU time than allowed. CPU time measures
> actual processing cycles used by your code, excluding time spent waiting for I/O or
> sleeping. Currently limited to 2000 milliseconds.
>
> **When it happens:** Your function is performing too much computation. This includes
> complex calculations, data processing, encryption, or other CPU-intensive operations.

([Shutdown reasons](https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained))

**No plan variation is documented.** Supabase gives a single figure with no plan
breakdown, and does so on a page that *does* break the wall clock down by plan two lines
above, and the functions-per-project limit four lines below — so the omission looks
deliberate rather than accidental. Read strictly, the docs are silent on whether CPU time
varies by plan; read in context, paying for Pro buys wall clock, not CPU. Nothing on the
pricing or limits pages offers a way to raise it.

### It resets per request

The limits page says "per request", and the runtime source confirms it rather than
merely implying it. In the per-worker supervisor, a request entering resets the CPU
timer with fresh soft and hard limits:

```rust
CPUUsageMetrics::Enter(_thread_id, timer) => {
    state.worker_enter();
    if !state.is_cpu_time_limit_disabled {
        cpu_timer_rx = Some(timer.set_channel().in_current_span().await);
        if let Err(err) = timer.reset({ runtime_opts.cpu_time_soft_limit_ms }, cpu_time_hard_limit_ms)
```

and the hard limit is what trips the shutdown:

```rust
if cpu_usage_ms >= cpu_time_hard_limit_ms as i64 {
    error!("CPU time hard limit reached: isolate: {:?}", key);
    complete_reason = Some(ShutdownReason::CPUTime);
```

([`crates/base/src/worker/supervisor/strategy_per_worker.rs`](https://github.com/supabase/edge-runtime/blob/main/crates/base/src/worker/supervisor/strategy_per_worker.rs))

This is the one genuinely good piece of news in the CPU section, and the whole basis of
the recommendation in section 10: **N invocations get N × 2 s of CPU.** Splitting the
Upload's work across requests is not a workaround the docs merely tolerate — it is
Supabase's own advice, listed as remedy 5 on the 546 page: "Split operations into
individual functions: Break a large function into smaller ones, each responsible for a
single sub-task. Stitch the results together at the app level or via an orchestrating
function"
([546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response)).
The same page cautions that self-calling functions need an escape condition, and the
limits page bounds recursive/nested calls at "~5000 requests per minute".

### Why 2 s is the wall for ADR-0009's preview

The preview, as ADR-0009 specifies it, does all of the following inside one request:
inflate a zip of up to 50 MB; SHA-256 the unzipped files in sorted path order; build an
HTML5 tree over the whole `index.html`; walk it removing everything outside ADR-0005's
allowlist; parse the CSS and rewrite every selector; serialise; walk the sanitised tree
again to extract and segment text; and string-match every Open Thread. Every one of
those is CPU, not I/O — so none of it is excluded by the "does not include async I/O"
carve-out.

Supabase's own catalogue of what blows this limit reads like a description of that list:
"CPU intensive recursions", "Unbounded memory allocation", and under Example cases,
"Performing edits against images or other large files can be both CPU and Memory
intensive", where one of the three suggested remedies is "restricting the file size to
reduce strain"
([546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response)).

Supabase publishes no throughput figures for any of this, and none are invented here.
The honest statement of the risk is structural rather than numeric: **2 s of CPU is a
cliff, not a budget you can size a 50 MB ceiling against.** Where it falls depends on
how much markup a document holds, which the Author controls and Marginly cannot
predict, and crossing it yields a 546 with no partial result and no way to resume. A
Book that previews fine at 8 MB may fail at 12 MB, and the same 12 MB file may fail
only sometimes, depending on whether it landed on a warm isolate. That is not a limit
you can put behind an indeterminate loader and a confirm button.

## 4. Wall clock

Plan-dependent, and generous:

- Free plan: 150 s
- Paid plans: 400 s

([Limits](https://supabase.com/docs/guides/functions/limits))

The semantics matter more than the number, and the limits page is careful about them:
"This is the duration an Edge Function worker will stay active. During this period, a
worker can serve multiple requests or process background tasks." So this is a **worker
lifetime**, not a per-request budget — which is why it is the limit that governs
background tasks, and why it is not the limit that governs parsing.

The shutdown-reasons page describes reason `WallClockTime` as measuring "the total
elapsed real time from when the function started, including time spent waiting for I/O,
external API calls, and sleeps", states "Currently, the wall clock limit is set at 400
seconds", and advises breaking long work into smaller functions, streaming responses,
moving work to background jobs or queues, handling partial completion, and making
operations idempotent so they can retry from the beginning
([Shutdown reasons](https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained)).
Note that page quotes only the paid figure, without the plan split the limits page
gives.

Separately there is a **request idle timeout of 150 s**: "If an Edge Function doesn't
send a response before the timeout, 504 Gateway Timeout will be returned"
([Limits](https://supabase.com/docs/guides/functions/limits)). This is the one that a
synchronous preview would actually be racing, and 150 s is ample — which is the point.
Wall clock was never the binding constraint, exactly as the ticket said.

A wall-clock termination also reports as 546, per the error metadata on the
shutdown-reasons page (`http_status_code = 546`, `message = "Edge Function 'wall clock
time limit reached'"`)
([Shutdown reasons](https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained)).

## 5. Other limits worth carrying into the design

From [Limits](https://supabase.com/docs/guides/functions/limits), the "Other limits &
restrictions" section:

- "Outgoing connections to ports `25` and `587` are not allowed."
- "Serving of HTML content is only supported with custom domains (Otherwise `GET`
  requests that return `text/html` will be rewritten to `text/plain`)."
- "Web Worker API (or Node `vm` API) are not available."
- "Static files cannot be deployed using the API flag. You need to build them with
  Docker on the CLI."
- "Node Libraries that require multithreading are not supported. Examples: `libvips`,
  `sharp`."

Three of these bear on Marginly.

**No Node `vm`.** This single-handedly rules out jsdom, and with it DOMPurify's
supported configuration. See section 8.

**No multithreading.** Any parser or sanitiser that reaches for worker threads is out,
which is a further argument for the pure-JS and WASM options in sections 7 to 9.

**HTML must be served from a custom domain.** This does *not* bite today — ADR-0005
serves a Version through an application route that checks access, i.e. Next.js, not an
Edge Function. It is recorded here because it is a trap if the Version-serving route is
ever moved onto a function: the HTML would silently arrive as `text/plain`.

The failure statuses, for the preview's error handling
([Status codes](https://supabase.com/docs/guides/functions/status-codes)):

| Status | Meaning |
| --- | --- |
| 401 | JWT verification enabled, token invalid or missing |
| 404 | Function does not exist or path wrong |
| 405 | Method outside `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`OPTIONS` |
| 500 | Uncaught exception (`WORKER_ERROR`) |
| 503 | Failed to boot (`BOOT_ERROR`) — syntax or import errors |
| 504 | No response before the request idle timeout |
| 546 | Resource limit (`WORKER_RESOURCE_LIMIT`) — memory or CPU |

Error responses "may also include an `sb-error-code` header that identifies the specific
error condition"
([Status codes](https://supabase.com/docs/guides/functions/status-codes)). 546 is the one
the preview has to handle as a domain outcome rather than an unexpected error, and
because it carries no partial result, the message to the Author can only be that the
Book is too large to preview.

## 6. Ephemeral storage and background tasks — the pattern Supabase documents for exactly this

This section exists because Supabase's documentation contains a worked example that is
almost line-for-line Marginly's Upload preview, and any decision on ADR-0009 should be
made in full knowledge of it.

### `/tmp` exists and is per-invocation

"Ephemeral - You can read and write files to the `/tmp` directory. Only suitable for
temporary operations." And: "Ephemeral storage will reset on each function invocation.
This means the files you write during an invocation can only be read within the same
invocation."

Limits:

- Free projects: Up to 256MB of ephemeral storage
- Paid projects: Up to 512MB of ephemeral storage

([File Storage](https://supabase.com/docs/guides/functions/ephemeral-storage))

**Per-invocation reset is the sharp edge for Marginly.** It means `/tmp` cannot be the
staging prefix ADR-0009 relies on: a file written during the preview is gone by the
confirm, and gone even between two invocations of a split preview. `/tmp` is scratch
space *within* one invocation, and nothing more.

### The zip example, verbatim

Under "Archive processing with background tasks":

> You can use ephemeral storage with Background Tasks to handle large file processing
> operations that exceed memory limits.
>
> Imagine you have a Photo Album application that accepts photo uploads as zip files. A
> streaming implementation will run into memory limit errors with zip files exceeding
> 100MB, as it retains all archive files in memory simultaneously.
>
> You can write the zip file to ephemeral storage first, then use a background task to
> extract and upload files to Supabase Storage. This way, you only read parts of the zip
> file to the memory.

```tsx
Deno.serve(async (req) => {
  const uploadId = crypto.randomUUID()
  const filepath = `/tmp/${uploadId}.zip`

  // Write zip to ephemeral storage
  await Deno.writeFile(filepath, req.body)

  // Process in background to avoid memory limits
  EdgeRuntime.waitUntil(processZipFile(uploadId, filepath))

  return new Response(JSON.stringify({ uploadId }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

([File Storage](https://supabase.com/docs/guides/functions/ephemeral-storage))

Three things to take from it. First, `Deno.writeFile(filepath, req.body)` streams the
request body straight to disk — the compressed bytes never have to be resident, which
answers ADR-0009's concern about holding "the compressed zip and the unzipped tree at
once". Second, Supabase's stated memory threshold for in-memory zip handling is 100 MB,
comfortably above Marginly's 50 MB, which suggests memory is workable even without
`/tmp` provided the tree is not also held. Third — and this is the catch — the example
returns an `uploadId` immediately and does the work afterwards. **It is not a
synchronous preview.** It is the asynchronous design ADR-0009 chose against.

### Background task limits

"You can use `EdgeRuntime.waitUntil(promise)` to explicitly mark background tasks. The
Function instance continues to run until the promise provided to `waitUntil` completes."
A `beforeunload` listener gives notice of shutdown: "Use beforeunload event handler to
be notified when function is about to shutdown … Save state or log the current
progress." And the limit, from the page's own admonition:

> The maximum duration is capped based on the wall-clock, CPU, and memory limits. The
> function will shut down when it reaches one of these limits.

([Background Tasks](https://supabase.com/docs/guides/functions/background-tasks))

So a background task buys wall clock — up to 400 s on a paid plan — and buys the ability
to stream through a large archive without holding it. It does not, on the face of this
sentence, buy CPU. Whether the 2 s applies to a background task as a fresh budget or as
the same budget the spawning request already spent is not documented, and section 3's
source reading does not settle it either: the runtime resets the CPU timer when a
request *enters*, and a background task by definition runs when no request is active.
This is the open question that matters most.

### Persistent storage, which does not have these problems

Edge Functions can mount an S3-compatible bucket, Supabase Storage included, as a POSIX
filesystem: set `S3FS_ENDPOINT_URL`, `S3FS_REGION`, `S3FS_ACCESS_KEY_ID` and
`S3FS_SECRET_ACCESS_KEY` as function secrets and read or write under
`/s3/YOUR-BUCKET-NAME` with ordinary `Deno.readFile` / `Deno.writeTextFile` /
`Deno.mkdir` calls. "There are no limits on S3 buckets you mount for Persistent
storage."
([File Storage](https://supabase.com/docs/guides/functions/ephemeral-storage))

This is directly useful to ADR-0009 twice over: it is how a split preview hands work
from one invocation to the next, and it is how the confirm reads the extracted text back
and copies staged objects to the Version prefix without pulling either through memory.

### One gotcha that will cost an afternoon

Synchronous file APIs are usable "*during initial script evaluation*" only, and are
blocklisted inside handlers and callbacks:

```tsx
Deno.statSync('...') // ✅

Deno.serve(() => {
  Deno.statSync('...') // 💣 ERROR! Deno.statSync is blocklisted on the current context
})
```

([File Storage](https://supabase.com/docs/guides/functions/ephemeral-storage))

Any unzip library reaching for `readFileSync` will fail inside the request handler.

### Invoking a function without a browser waiting

If the preview becomes asynchronous, it needs a trigger. Supabase documents `pg_cron`
plus `pg_net` — `cron.schedule()` around a `net.http_post()` to the function URL, with
the URL and key held in Vault via `vault.create_secret(...)` and read back decrypted
([Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)).
No limits or caveats on that path are stated beyond the recommendation to use Vault.

### Local development

Background tasks do not run to completion under the CLI unless the runtime policy is
changed: "When testing Edge Functions locally with Supabase CLI, the instances are
terminated automatically after a request is completed. This will prevent background
tasks from running to completion." The fix is in `supabase/config.toml`:

```toml
[edge_runtime]
policy = "per_worker"
```

([Background Tasks](https://supabase.com/docs/guides/functions/background-tasks))

The 546 page adds that the CLI reproduces the hosted resource limits — "The same
constraints placed on edge function's hosted by Supabase are also imposed by the test
environment spun-up by the CLI" — and suggests inducing failures locally with
`supabase functions serve your-function --debug`, explicitly including "sending a large
payload" as a test worth trying
([546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response)).
So the experiments in section 11 can be run locally before anything is deployed.

## 7. An HTML5 parser that recovers rather than fails

ADR-0005 requires a parser that recovers from malformed HTML rather than failing,
because "malformed HTML is not [refused] — an HTML5 parser recovers rather than fails,
so there is no unparseable case to rule on." That guarantee needs a real HTML5 tree
construction algorithm, error handling included, not a lenient hand-written parser that
happens not to throw. Two options qualify.

### The runtime they have to run on

Supabase Edge Functions accept "JavaScript modules from npm", "Built-in Node APIs",
and "Modules published to JSR or deno.land/x", with the documented import forms:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import process from 'node:process'
import path from 'jsr:@std/path@1.0.8'
```

and per-function `deno.json` as the recommended way to pin them
([Managing dependencies](https://supabase.com/docs/guides/functions/dependencies)).

WebAssembly is supported: "Edge Functions supports running WebAssembly (Wasm) modules",
though shipping your own `.wasm` needs `static_files` in `config.toml`, CLI 2.7.0 or
higher, and a Docker-based deploy — "Static files cannot be deployed using the
`--use-api` API flag. You need to build them with Docker on the CLI"
([WASM modules](https://supabase.com/docs/guides/functions/wasm)). No size limit is
documented on that page; the 20 MB / 5 MB figures are function bundle limits from the
limits page.

That page also says Edge Functions "currently use Deno 1.46", which conflicts with the
runtime's own source: `edge-runtime` on `main` vendors a `deno` crate at **version
2.1.4** on `deno_core 0.324.0`
([`deno/Cargo.toml`](https://github.com/supabase/edge-runtime/blob/main/deno/Cargo.toml),
[workspace `Cargo.toml`](https://github.com/supabase/edge-runtime/blob/main/Cargo.toml)).
Deno 2.1 was rolled out behind `forceDenoVersion` / `x-deno-version` opt-ins
([changelog](https://supabase.com/changelog/36814-deno-2-1-preview-hosted-environment)).
**Which Deno version a given project gets today is not documented**, and section 7's
choice of deno-dom entrypoint depends on it — so it has to be probed at runtime rather
than assumed.

Dependencies are serialised into an **eszip** at deploy time
([Node and npm support](https://supabase.com/blog/edge-functions-node-npm)), which
raises a question the docs do not answer; see the deno-dom entrypoints below.

### `jsr:@b-fuze/deno-dom` — html5ever, via WASM

deno-dom credits "html5ever developers for the HTML parser", built with Rust and
WebAssembly, with selector matching from nwsapi
([README](https://github.com/b-fuze/deno-dom/blob/master/README.md)). That is verifiable
in the source rather than only claimed in prose: the parser crate declares
`html5ever = "0.25.1"` and `markup5ever = "0.10.0"`
([`html-parser/core/Cargo.toml`](https://github.com/b-fuze/deno-dom/blob/master/html-parser/core/Cargo.toml)).
html5ever is a spec HTML5 tree builder, so this is genuine error recovery rather than
tolerance — though note the pin is to an old html5ever, 0.25.1.

Two backends, and only one is usable here:

- WASM: `jsr:@b-fuze/deno-dom`, needing only `--allow-read --allow-net`.
- Native/FFI: `jsr:@b-fuze/deno-dom/native`, needing `--unstable-ffi --allow-ffi
  --allow-env --allow-read --allow-net=deno.land`.

([README](https://github.com/b-fuze/deno-dom/blob/master/README.md))

The native backend is faster but requires FFI *and* downloads a library at runtime, and
Supabase grants functions neither; the WASM backend is the one to use, and the README says
it "is sufficient for almost all use-cases".

**The WASM entrypoints are not equivalent, and the difference lands on the CPU budget.**
The default export branches at runtime on the Deno version: on Deno ≥ 2.1 it imports the
`.wasm` module directly, otherwise it falls back to a base64-embedded copy inlined in
JavaScript. The `wasm-legacy` and `wasm-noinit` entrypoints always take the base64 path,
with `wasm-noinit` gating it behind an explicit `await initParser()`. The two artefacts are
**525,785 bytes** for the raw `.wasm` and **701,361 bytes** for the base64 variant. The
base64 path is the expensive one: 700 KB of JavaScript to parse and compile, then decode,
then instantiate — all of it CPU, against a 2 s ration. The README notes the historical
top-level-await penalty for the legacy WASM module, "resolved in Deno v2.1".

This interacts badly with a fact from section 2. Instantiation is a cold-start cost that a
warm worker amortises across requests — but the isolate retirement rule means an isolate
shuts down after using 50% of any resource, and an Upload preview is precisely the
heavyweight request that trips it. So Marginly's previews are the requests *least* likely
to land on a warm isolate, and most likely to pay instantiation every time. Do not budget
on amortisation.

**And whether the `.wasm` even survives deployment is undocumented.** Supabase documents
`static_files` for a `.wasm` *you* build, but says nothing about a `.wasm` arriving as a
transitive module of a `jsr:` dependency and being serialised into the eszip
([WASM modules](https://supabase.com/docs/guides/functions/wasm),
[Node and npm support](https://supabase.com/blog/edge-functions-node-npm)). If it does not,
the base64 entrypoint is the deployment-safe choice and the CPU cost above is unavoidable.
Both artefacts are published to JSR, so both are at least available. This needs probing,
not assuming.

Latest version is **0.1.56**, published to JSR on 2025-07-31, with `runtimeCompat`
declaring deno, node, browser, workerd and bun
([JSR package metadata](https://api.jsr.io/scopes/b-fuze/packages/deno-dom)). Caveats to
record: the version is `0.1.x`; the README says "Deno DOM is still under development, but
is fairly usable for basic HTML manipulation needs"; the last release is roughly twelve
months before this note; and tagged releases stopped in 2023.

### `npm:parse5@8` — the reference-grade alternative

parse5 describes itself as "WHATWG HTML Living Standard (aka HTML5)-compliant" and "the
fastest spec-compliant HTML parser for Node to date", and states that it "parses HTML
the way the latest version of your browser does"
([README](https://github.com/inikulin/parse5/blob/master/README.md)). Its toolset
includes `parse5-html-rewriting-stream`, `parse5-sax-parser` and
`parse5-htmlparser2-tree-adapter`.

For this runtime it has an attractive shape: version **8.0.1** (2026-04-19), `"type":
"module"`, and exactly one runtime dependency, `entities`
([npm metadata](https://registry.npmjs.org/parse5/8.0.1)). No native code, no Node
builtins, no WASM to deploy as a static file. It is also, independently, the parser jsdom
itself uses (see below), which is a reasonable proxy for spec fidelity.

The trade-off against deno-dom is API shape rather than correctness: parse5 gives a
document tree and a serialiser but not a DOM with `querySelectorAll`. For ADR-0005's
work — walk the tree, drop nodes outside a fixed allowlist, serialise, walk again
collecting text with segment boundaries at named elements — a tree walk is all that is
needed, and `parse5-sax-parser` is there if streaming ever becomes preferable to holding
a tree.

`parse5-html-rewriting-stream` deserves a specific mention: it is a streaming rewriter,
which is the shape that would let sanitisation happen without a full tree resident, and
therefore the shape most likely to fit inside a 2 s CPU slice.

### Throughput, since CPU is the constraint

Section 3 declined to invent numbers. There are published ones, from the libraries
themselves, and they are worth reading with their caveats attached.

deno-dom's own benchmark directory reports, over 40 runs on `c.html`:

```
Raw parse:                    Deno DOM WASM 44.45ms | Native 25.75ms | Node parse5 167.74ms
Parse + DOM + querySelectorAll: Deno DOM WASM 65.75ms | Native 37.81ms | Node JSDOM 488.21ms
```

([`bench/README.md`](https://github.com/b-fuze/deno-dom/blob/master/bench/README.md))

`c.html` is **1,422,225 bytes**
([`bench/` contents](https://github.com/b-fuze/deno-dom/tree/master/bench)), so the WASM
raw-parse figure is roughly **32 MB of HTML per second**. The harness runs `runs` untimed
warmup iterations before it starts measuring
([`bench/bench-wasm-parse.ts`](https://github.com/b-fuze/deno-dom/blob/master/bench/bench-wasm-parse.ts)),
so that figure **excludes** WASM instantiation — instantiation is on top.

Four caveats, all of which matter. The author's own: "These benchmarks should really be
taken with a grain of salt, but they aren't entirely dismissible in my opinion." The
hardware is an AMD Ryzen 5 4500U, a laptop part, and Edge Function CPU allocation is not
documented. The Deno version is **1.16.1**, from 2021. And it is one document, not a corpus.

**What this does and does not say about a 50 MB Upload.** It would be wrong to divide 50 MB
by 32 MB/s: the 50 MB is the *zip*, and a Book's zip is mostly images. ADR-0005's parse
touches only `index.html`. At ~32 MB/s a 2 MB export costs on the order of 60 ms and a
10 MB export on the order of 300 ms — survivable in isolation. The danger is the total,
because the preview also inflates the whole 50 MB, SHA-256s every extracted file, walks the
tree to sanitise, serialises it, parses and rewrites the CSS, walks again to extract and
segment, and string-matches every Open Thread. Parse is one term in that sum and not
obviously the largest; inflate and hash scale with the full 50 MB rather than with the
markup. So the honest reading is that a typical Book probably fits and a heavy one probably
does not, with no documented figure for where the line falls — which is exactly why
section 11 asks for a measurement rather than a calculation.

**On relative speed, the direction is consistent even where magnitudes are not.**
htmlparser2's README reports `htmlparser2: 2.17215 ms/file` against
`parse5: 9.70406 ms/file` on htmlparser-benchmark
([README](https://github.com/fb55/htmlparser2/blob/master/README.md)); other runs of the
same benchmark put the ratio nearer 3×. Either way parse5 is several times slower than the
non-spec-compliant parsers, and deno-dom's own bench puts its WASM path roughly 3.8× faster
than Node parse5. Cross-machine, cross-runtime benchmark comparisons are weak evidence, so
this is not a reason to treat deno-dom as safe — but it does mean **deno-dom's WASM backend
is the fastest spec-compliant option available on this runtime**, and on a CPU-bound
workload that outweighs parse5's cleaner maintenance story. The recommendation table below
is revised accordingly.

### Ruled out

**jsdom.** Version 30.0.1 (2026-07-29) is pure JavaScript and well-maintained, and its
dependency list is instructive — it uses `parse5` for HTML and `css-tree` for CSS
([npm metadata](https://registry.npmjs.org/jsdom)). But `lib/jsdom/browser/Window.js`
opens with `const vm = require("node:vm");` and builds the window with
`vm.createContext(vm.constants.DONT_CONTEXTIFY)`
([`Window.js`](https://github.com/jsdom/jsdom/blob/main/lib/jsdom/browser/Window.js)).
The require is unconditional at module scope, so it is not avoided by leaving
`runScripts` off, and it is not the only such site — `lib/api.js` requires `vm` near the
top of the file too
([`api.js`](https://github.com/jsdom/jsdom/blob/main/lib/api.js)). Supabase states "Web
Worker API (or Node `vm` API) are not available"
([Limits](https://supabase.com/docs/guides/functions/limits)). jsdom cannot construct a
Window here.

**linkedom** (0.18.13, 2026-07-07) describes itself as "A triple-linked lists based DOM
implementation"
([npm metadata](https://registry.npmjs.org/linkedom)). It is fast and pure JS, but its
own description makes no claim of HTML5 tree-construction compliance, and ADR-0005's
guarantee rests on that claim. Not ruled out on evidence of failure — ruled out for
absence of the guarantee.

**Deno's own `DOMParser`.** There isn't one for HTML. Deno's docs are explicit: "Deno is a
JavaScript runtime that operates outside of the browser, as such, you cannot directly
manipulate the Document Object Model in Deno as you would in a browser", and the page then
names deno-dom, jsdom and linkedom as the alternatives to reach for
([Web testing tutorial](https://docs.deno.com/examples/web_testing_tutorial/)). A request
for a built-in remains open
([denoland/deno#24995](https://github.com/denoland/deno/issues/24995)). So a third-party
parser is not a preference here, it is the only option.

**`HTMLRewriter`.** Cloudflare Workers expose a streaming `HTMLRewriter` global, which
would have been an excellent fit for a CPU-bound sanitise pass. Supabase's Edge Functions
documentation never mentions one, and a code search for the identifier returns **zero hits
in both `supabase/edge-runtime` and `denoland/deno`** — against a control query for `Deno`
in the same repository returning 597, so the search itself works. Treat it as unavailable.
Supabase's docs are silent on it, which is the weaker of the two findings; the absent
identifier is the stronger one.

## 8. Sanitising

### DOMPurify cannot be used the way its maintainers require

DOMPurify is the obvious candidate — 3.4.13, published 2026-08-03, actively maintained
([npm metadata](https://registry.npmjs.org/dompurify)) — and its own README is the reason
not to reach for it here. "Running DOMPurify on the server requires a DOM to be present",
with this as the documented setup:

```js
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const clean = DOMPurify.sanitize('<b>hello there</b>');
```

The maintainers are explicit that the choice of DOM is a security decision, not an
implementation detail: "older versions of jsdom are known to be buggy in ways that result
in XSS even if DOMPurify does everything 100% correctly", and, naming an alternative,
"tools like happy-dom exist but are not considered safe at this point. Combining
DOMPurify with happy-dom is currently not recommended and will likely lead to XSS." Their
overall position: "Other than that, you are fine to use DOMPurify on the server.
Probably. This really depends on jsdom or whatever DOM you utilize server-side."
([README](https://github.com/cure53/DOMPurify/blob/main/README.md))

jsdom is unavailable here (section 7). Pairing DOMPurify with deno-dom instead is
precisely the substitution its maintainers decline to bless. Given ADR-0005's threat
model — "Marginly serves the Author's HTML on its own origin inside a Reviewer's session,
so a surviving `script` tag is stored XSS against every Book that Reviewer can read" —
running the sanitiser in a configuration its authors warn about is not a trade worth
making silently. Record it as a decision rather than an oversight.

### `sanitize-html` is available but is not a spec parser

`sanitize-html` 2.17.6 (2026-07-10) is pure JS and would very likely run, but its
dependency list shows what it is built on: `htmlparser2`, plus `postcss` for style
handling
([npm metadata](https://registry.npmjs.org/sanitize-html)). htmlparser2 does not claim to
be a spec parser and says so itself, on the second line of its README: "_htmlparser2 is the
fastest HTML parser, and takes some shortcuts to get there. If you need strict HTML spec
compliance, have a look at parse5._"
([README](https://github.com/fb55/htmlparser2/blob/master/README.md)).

Adopting it would quietly weaken ADR-0005's "an HTML5 parser recovers rather than fails"
from a spec guarantee to a best-effort one — and it would mean the sanitiser and the
text-extraction walk disagree about what the document is, which is the one thing ADR-0005
is careful to prevent by extracting from the sanitised tree.

Worth knowing that Deno's own GFM renderer pairs the two libraries — `@deno/gfm` depends on
both `npm:sanitize-html@^2.17.0` and `jsr:@b-fuze/deno-dom@^0.1.56`
([`deno.json`](https://github.com/denoland/deno-gfm/blob/main/deno.json)) — so
`sanitize-html` is a plausible *second* pass for defence in depth on top of a spec parse.
It is not recommended here, on CPU grounds: a second full re-parse of the document is a
luxury a 2 s budget cannot fund. If the preview moves off Edge Functions, reconsider it.

### The recommendation: an allowlist pass over the parsed tree

ADR-0005 already specifies the allowlist, and specifies it as fixed and small: `script`,
`iframe`, `object`, `embed`, `form` and its inputs, every `on*` attribute, `javascript:`
and non-image `data:` URLs, and inline `style` attributes, removed unconditionally. That
is a tree walk with a name check, an attribute-prefix check and a URL-scheme check — not
a general-purpose sanitiser's problem.

It is also work the Upload has to do anyway. The text extraction in ADR-0005 walks the
sanitised tree with segment boundaries at `p`, `h1`–`h6`, `li`, `blockquote`, `pre`,
`figcaption` and `div`, inline elements contributing text with no space, tables excluded.
One walk, two outputs, one tree, one parser — and the invariant that extraction sees
exactly what sanitisation produced is structural rather than maintained by convention.

The cost is honest and should be written down: hand-rolled allowlists are where XSS
lives, and this one has to be reviewed as security code and tested against real Word and
Pandoc exports, mutation-XSS cases and namespace confusion (SVG/MathML `foreignObject`
being the classic). Its saving grace is that ADR-0005 made the security-critical half of
the list fixed and the growable half render-only, so the code that matters does not
churn.

## 9. A CSS parser that can scope selectors and drop rules

ADR-0005 needs three things from CSS: scope every selector to the content container,
drop `@import`, and drop `position: fixed` and `position: sticky`, while keeping `url()`
and `@font-face`. That rules out string prefixing — `:root`, `html`, `body`, comma lists,
`@media` and `@supports` nesting, `@keyframes` (whose selectors are percentages and must
*not* be scoped) and `:has()` all need structure.

### `npm:css-tree@3` — the recommendation

css-tree is "a tool set for CSS: fast detailed parser (CSS → AST), walker (AST
traversal), generator (AST → CSS) and lexer (validation and matching) based on specs and
browser implementations", version **3.2.1** (2026-03-05)
([npm metadata](https://registry.npmjs.org/css-tree),
[README](https://github.com/csstree/csstree/blob/master/README.md)).

Every requirement maps onto something it has. Its documented AST covers `SelectorList`,
`Selector`, `TypeSelector`, `ClassSelector`, `PseudoClassSelector`, `Combinator`,
`NestingSelector`, `Nth`, `Atrule`, `AtrulePrelude`, `MediaQueryList`,
`SupportsDeclaration`, `Url` and `Raw`
([`docs/ast.md`](https://github.com/csstree/csstree/blob/master/docs/ast.md)), so scoping is
an AST rewrite rather than a regex, `@import` is a node type to drop, `@keyframes` is a node
type to leave alone (its "selectors" are percentages and must not be scoped), and `Url` is a
node type to leave alone per ADR-0005's decision to keep `url()`.

One detail worth recording, because reading `ast.md` alone gets it wrong: that document
types `PseudoClassSelector.children` as `List<Raw>`, which would suggest `:has(...)` contents
are opaque. They are not. The pseudo-class registry maps `has`, `is`, `where`, `not` and
`matches` to a real `selectorList` sub-parser, the `nth-*` family to `nth`, and
`slotted`/`host`/`host-context` to `selector`
([`lib/syntax/pseudo/index.js`](https://github.com/csstree/csstree/blob/master/lib/syntax/pseudo/index.js)).
So `:has(a, b)` nests a genuine `SelectorList` that a scoping pass can recurse into — which
matters, because a selector inside `:has()` that escapes scoping escapes it completely.

It is error-tolerant in the way this input demands: the parser "attempts to recover
gracefully, throwing away only the minimum amount of content before returning to parsing as
normal", wrapping what it cannot parse "in a special node type (`Raw`) that allows processing
it later". That last point cuts both ways and should be designed for: a `Raw` node is CSS
that survived *unparsed*, so anything landing in one has to be **dropped** rather than
passed through, or it is a hole in the scoping guarantee of exactly the kind ADR-0005
identifies for `@import`.

It is also written "with focus on performance and effective memory consumption", which is
the right disposition for a 2 s CPU budget; it is the CSS engine jsdom depends on
([jsdom npm metadata](https://registry.npmjs.org/jsdom)); and it is pure JS, with only
`mdn-data` and `source-map-js` as dependencies
([npm metadata](https://registry.npmjs.org/css-tree)).

### `npm:postcss@8` — workable, but the wrong shape

postcss 8.5.26 (2026-08-06) has three dependencies, all pure JS: `nanoid`, `picocolors`
and `source-map-js`
([npm metadata](https://registry.npmjs.org/postcss)). Nothing there needs a Node builtin
Supabase lacks, so `npm:postcss@8` should work.

The objection is shape rather than availability. postcss has no selector AST of its own —
you would add `postcss-selector-parser` on top — and the obvious off-the-shelf scoping
plugin does not do what ADR-0005 needs: `postcss-prefix-selector` builds its output by
string concatenation (`return prefixWithSpace + selector`) plus a regex rewriting
`html`/`:root`/`body`, so while it correctly skips `@keyframes` and its comma splitting is
paren-aware enough that `:has(a, b)` is not torn in half, it cannot reach *inside* `:has()`
to scope what is there
([`index.js`](https://github.com/RadValentin/postcss-prefix-selector/blob/master/index.js)).
Given that a selector escaping scoping is the failure ADR-0005 exists to prevent, an AST
that nests is worth more here than a plugin that ships.

### Ruled out

**`lightningcss` — on size.** The native package needs platform binaries. The WASM build,
`lightningcss-wasm@1.33.0` (2026-07-20), is Deno-usable in principle but unpacks to
**16,232,340 bytes**
([npm metadata](https://registry.npmjs.org/lightningcss-wasm)) — over the 5 MB
server-side-bundled function limit outright, and most of the 20 MB CLI limit
([Limits](https://supabase.com/docs/guides/functions/limits)). Before considering the CPU
cost of instantiating 16 MB of WASM, it does not fit.

**`@adobe/css-tools` and `stylis` — no selector AST.** Both represent selectors as strings
rather than structure (`@adobe/css-tools` types them `Array<string>`; `stylis` exposes
`props: ['h1','h2']`), which puts them in the same category as string prefixing.

Supabase's documentation does not name any of these libraries, and there is no Supabase
example of HTML parsing or CSS rewriting in an Edge Function to copy from
(searched across `supabase/supabase`; **the docs are silent**).

### Recommended stack

| Job | Choice | Why |
| --- | --- | --- |
| HTML5 parse | `jsr:@b-fuze/deno-dom@0.1.56` | html5ever 0.25.1 via WASM, real DOM API, and the fastest spec-compliant option on this runtime — which is what a 2 s CPU budget rewards. Costs: `0.1.x`, ~12 months since release, and WASM instantiation lands on the budget |
| HTML5 parse (fallback) | `npm:parse5@8.0.1` | If deno-dom's staleness or the eszip `.wasm` question disqualifies it. Current, one dependency (`entities`), no WASM to deploy — but several times slower, and no `querySelector` |
| Sanitise | Hand-rolled closed allowlist over the parsed tree, serialised via `outerHTML` | ADR-0005's list is fixed and small; DOMPurify's supported DOM is unavailable; `sanitize-html`'s parser is not spec-compliant; one walk serves sanitisation and extraction both |
| CSS | `npm:css-tree@3.2.1` | Selector AST that nests into `:has()`, at-rule nodes, error-tolerant with `Raw`, fast, pure JS, two dependencies |

The HTML choice is the one genuinely close call in this note, and it is close because the
two candidates fail in different directions: deno-dom is faster and less maintained, parse5
is maintained and slower. CPU is the binding constraint, so speed wins on the evidence
available — but the evidence is a 2021 benchmark on a laptop, so this is the recommendation
most likely to be overturned by experiment 2 in section 11. Decide it with a measurement,
not with this table.

## 10. Verdict

ADR-0009 made its synchronous preview conditional on this answer. The answer does not
support it.

### What the limits rule out

**A synchronous preview that does the Upload's work inside the request that carries the
zip.** 2 s of CPU per request is the whole of it. Unzip, hash, parse, sanitise, scope CSS,
extract, segment and match is CPU-bound from end to end, the limit excludes only async
I/O, and the failure is a 546 carrying no partial result. The problem is not that 2 s is
too small on average — it may well be enough for a typical Book. The problem is that it
is a cliff whose position is set by how much markup an Author's export happens to contain,
so a 50 MB ceiling cannot be promised behind it, and the same file can fail or pass
depending on isolate warmth. ADR-0009's "one indeterminate loader for the whole wait —
transfer and processing are not distinguished, because once the bytes have moved the rest
is too fast to read" is the specific sentence this contradicts. The rest is not too fast to
read; it is the expensive part, and it has a hard 2 s ration.

**Holding the compressed zip, the unzipped tree and a parsed DOM at once at 50 MB scale.**
Supabase's own threshold for in-memory archive handling is "zip files exceeding 100MB"
([File Storage](https://supabase.com/docs/guides/functions/ephemeral-storage)), and its
memory limit is variously 256 MB, 250 MB or 150 MB depending on which page you read. A
50 MB zip plus its expansion plus a tree plus a CSS AST plus extracted text is not a
comfortable fit under 150 MB. It is avoidable — stream the body to `/tmp`, read entries
one at a time — but only by not writing the function the way ADR-0009 describes.

**The claim that the function's body limit is the ceiling on a Book.** There is no
documented Edge Function request body limit, so nothing supports that sentence. ADR-0005
does not need a smaller number; ADR-0009's consequence needs replacing with the real
constraint, which is CPU.

### What the limits do *not* rule out

Receiving 50 MB as a request body is not itself a problem: no documented limit sits below
it, and Supabase's own example streams `req.body` to disk without buffering. Nor is doing
this work in an Edge Function ruled out — CPU resets per request, and Supabase's own
advice for CPU-bound work is to split it across functions. What is ruled out is doing it
*synchronously, in one request*.

### The smallest change that fits

Of the three the ticket offers, **staging the zip in Storage from the browser is not
sufficient on its own, and splitting the work across invocations is the change that
actually matters.** Staging moves bytes; it does not move the CPU wall. Do both, and the
smaller of the two is the one that has to be there.

Concretely, and preserving as much of ADR-0009 as possible:

1. **The browser stages the zip.** Either upload it to the staging bucket directly, or
   POST it to a function that only streams `req.body` to storage and returns. That
   invocation does no parsing, so it spends approximately no CPU, and the 50 MB question
   becomes Storage's documented 50 MB / 500 GB limit again — a limit that exists and is
   plan-legible — instead of an undocumented one.
2. **The preview runs as a sequence of invocations, each with its own 2 s.** Natural
   seams, each ending with its output in the staging prefix: unzip and hash; sanitise and
   scope CSS; extract, segment and count Unlinks. Each reads its input from the staging
   prefix and writes its output there, over the S3FS mount, so nothing large crosses a
   function boundary in memory and nothing depends on `/tmp` surviving (it does not).
3. **The Author's loader polls.** ADR-0008's preview screen is unchanged in what it shows
   — Book name, twenty segments, Unlink count. ADR-0009's single indeterminate loader
   survives as a loader; it just stops being one request.

What this leaves untouched is most of ADR-0009: the staging prefix and its clearing, the
refuse-on-duplicate hash comparison, one unconfirmed bundle per Book, matching in the
preview being thrown away, and the entire confirm — copy then transaction, `set local
role`, the privilege-free connection, the version-number bump's row lock. None of that is
affected by how the preview's CPU is rationed. The confirm was already cheap and stays a
single synchronous invocation.

**The background-task variant is smaller in code and worse in fit.** Supabase documents it
and it is tempting: stream to `/tmp`, `EdgeRuntime.waitUntil(processZip(...))`, return an
id. It fixes memory and it buys wall clock. But it does not clearly buy CPU — the docs say
background tasks are capped by the CPU limit too — and it forces the same
return-an-id-and-poll shape as splitting. So it costs ADR-0009's synchrony without
reliably buying the headroom that was the reason to give synchrony up. Prefer it only if
the experiment in section 11 shows background tasks get a fresh CPU budget; then it becomes
the smallest change of all, and step 2 above collapses into one invocation.

**Moving the preview off Edge Functions is the only option that keeps it synchronous.** A
Next.js route on a Node host, or a container, has neither a 2 s CPU cap nor a 150 MB
memory cap, and could do the whole thing in one request exactly as ADR-0009 wrote it.
Supabase names this itself: "Edge functions have a hard resource limit. If your work
requires more resources than we permit, you can look into other solutions, such as AWS
Lambda, that are less restrictive, or self-host edge functions and reconfigure the
settings"
([546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response)).
It is the larger change to the stack and the smaller change to the design.

So the decision ADR-0009 has to make is not really between three options. It is: **if the
synchronous preview is worth keeping, the preview leaves Edge Functions; if Edge Functions
are worth keeping, the preview stops being synchronous.** Both are defensible. What is not
available is both at once.

### What ADR-0005 needs

Its Size section should stop resting the ceiling on Supabase Storage's file size limit
alone. Storage's 50 MB on Free is real and stays relevant once step 1 above puts the zip
in a bucket — but it is not what will actually refuse a Book. Recommended replacement:
record 50 MB as the storage ceiling, and record separately that the processing ceiling is
set by the Edge Function CPU budget and is a function of document complexity rather than
file size, with the consequence that a Book can be small enough to store and too heavy to
preview. The sanitiser paragraph is unaffected — the parser and CSS toolchain ADR-0005
assumes do exist (sections 7 and 9) — but the allowlist should be understood as code
Marginly writes and reviews, not a library it configures (section 8).

## 11. What to measure before committing

Every number above is documented, and none of them says how much of a real Book fits in
2 s. Three cheap experiments, all runnable locally, since "The same constraints placed on
edge function's hosted by Supabase are also imposed by the test environment spun-up by the
CLI"
([546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response)):

1. **Does a background task get a fresh CPU budget?** The highest-value question in this
   note, because a "yes" collapses the recommendation to Supabase's own documented
   pattern. Stream a body to `/tmp`, then burn measured CPU inside
   `EdgeRuntime.waitUntil`, and watch for `CPUTime` in the shutdown event —
   `cpu_time_used` is reported in it
   ([Shutdown reasons](https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained)).
2. **How much real Book fits in 2 s?** Take the largest genuine Word or Pandoc export
   available, run the full unzip → hash → parse → sanitise → CSS → extract chain on it,
   and log `cpu_time_used` per stage. That gives the seams for step 2 of the
   recommendation, and tells you whether three invocations is the right number or one
   would have done. Run it twice, once on deno-dom and once on parse5, and let it settle
   the one close call in section 7 rather than leaving it to a 2021 benchmark. Log the
   first invocation separately from the rest, so WASM instantiation is visible as its own
   cost rather than smeared into the parse.
3. **Does a 50 MB body actually arrive?** Undocumented does not mean unlimited. POST 50 MB
   at a function that only reads `req.body` to `/tmp` and reports the byte count, and find
   out what the platform does. If something rejects it, that is the number the docs are
   missing.

## Open questions, and what the docs do not answer

**The request body size limit.** Not documented. The only figure Supabase ever published,
5 GB, was reverted by the Edge Functions maintainer as "not accurate", and the
replacement promised in October 2024 has not appeared
([PR #30132](https://github.com/supabase/supabase/pull/30132)). There is no per-plan
breakdown to give because there is no figure to break down.

**Which memory number is real.** 256 MB
([Limits](https://supabase.com/docs/guides/functions/limits)), 250 MB
([546](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response))
and 150 MB
([Compression](https://supabase.com/docs/guides/functions/compression)) all appear in
current Supabase documentation. Nothing reconciles them. Planning assumption above: 150 MB.

**Whether a background task's CPU is a fresh 2 s.** The background-tasks page says the
maximum duration "is capped based on the wall-clock, CPU, and memory limits" without
saying whose CPU budget. The runtime resets the timer when a request enters
([`strategy_per_worker.rs`](https://github.com/supabase/edge-runtime/blob/main/crates/base/src/worker/supervisor/strategy_per_worker.rs)),
and a background task runs when no request is active, which the source does not resolve
either way. Experiment 1 above.

**Whether WASM instantiation counts against the CPU budget.** It is CPU work by any
ordinary reading, and it would matter for deno-dom's WASM backend on a cold isolate, but
Supabase's Wasm page says nothing about it
([WASM modules](https://supabase.com/docs/guides/functions/wasm)). **The docs are silent.**
Section 7 argues it cannot be assumed away as a warm-worker amortisation, because the
isolate retirement rule makes heavy requests the ones least likely to find a warm isolate.

**Whether a `.wasm` from a `jsr:` dependency survives into the deployed eszip.** Supabase
documents `static_files` for a `.wasm` you build yourself and documents that the module
graph is serialised to an eszip, but says nothing about a transitive `.wasm` from a
registry dependency
([WASM modules](https://supabase.com/docs/guides/functions/wasm),
[Node and npm support](https://supabase.com/blog/edge-functions-node-npm)). **Not
documented.** This decides which deno-dom entrypoint to use — the cheap direct `.wasm`
import or the CPU-expensive base64 fallback — so it needs a deploy-and-see.

**Which Deno version a project actually runs.** The Wasm guide says 1.46; `edge-runtime`
`main` vendors 2.1.4
([`deno/Cargo.toml`](https://github.com/supabase/edge-runtime/blob/main/deno/Cargo.toml));
the changelog describes 2.1 arriving behind opt-in headers
([changelog](https://supabase.com/changelog/36814-deno-2-1-preview-hosted-environment)).
deno-dom's default entrypoint branches on exactly this, so it should be probed at runtime
rather than assumed.

**How the published parser benchmarks translate to this runtime.** deno-dom's figures are
Deno 1.16.1 on a Ryzen 5 4500U with the author's own "grain of salt" caveat, and the
cross-parser comparisons come from different machines and runtimes
([`bench/README.md`](https://github.com/b-fuze/deno-dom/blob/master/bench/README.md),
[htmlparser2 README](https://github.com/fb55/htmlparser2/blob/master/README.md)). Supabase
publishes nothing about the CPU its isolates get. Direction is trustworthy; magnitude is not.

**Response size and streaming-response limits.** The reverted PR would have said "Max
Response: No limit". With it gone, nothing documents a response limit either. Not a
constraint Marginly is near — the preview returns twenty segments and two counts — but
recorded for completeness.

**Concurrency and isolate counts per plan.** The limits page bounds functions per project
by plan and recursive calls at ~5000/minute, but says nothing about how many isolates a
project may run at once or whether that varies by plan
([Limits](https://supabase.com/docs/guides/functions/limits)). Not established.

**Whether `sb-error-code` distinguishes CPU from memory on a 546.** The status-codes page
says error responses "may also include an `sb-error-code` header" and points at an error
codes page; the 546 body carries only `WORKER_RESOURCE_LIMIT`, and the CPU-versus-memory
distinction is documented as visible in the *logs* (`CPU Time exceeded` /
`Memory limit exceeded`), not in the response
([Status codes](https://supabase.com/docs/guides/functions/status-codes),
[546](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response)).
So the Author-facing message cannot distinguish them, which argues for one message —
"this Book is too large to preview" — as with the generic magic-link error in the auth
note.

**Two dated pages.** The Wasm guide says "currently on Deno 1.46" although all regions
run a Deno 2.1-compatible release
([changelog](https://supabase.com/changelog/36814-deno-2-1-preview-hosted-environment)),
and the "request entity too large" discussion's 10 MB function-size answer is superseded
by the limits page's 20 MB / 5 MB
([Discussion #20864](https://github.com/orgs/supabase/discussions/20864)). Both are noted
because they are the kind of stale figure that gets quoted later.

**deno-dom's maintenance pace.** Latest release 0.1.56, published 2025-07-31, roughly a
year before this note, at a `0.1.x` version its own README calls "still under
development"
([JSR metadata](https://api.jsr.io/scopes/b-fuze/packages/deno-dom),
[README](https://github.com/b-fuze/deno-dom/blob/master/README.md)). Not abandoned, but
it is a dependency the sanitiser's correctness would rest on, which is part of why parse5
is listed first.
