# A background task shares the request's 2 s CPU budget

Measured on 2026-08-13 against a real Supabase project (`marginly`, Free plan,
`ap-south-1`, Postgres 17.6), because issue 15 could not settle it from the docs:
Supabase documents a 2 s CPU limit per request and says background tasks are
"capped based on the wall-clock, CPU, and memory limits", without saying whether
a task started in `EdgeRuntime.waitUntil` runs against the request's remaining
budget or gets one of its own.

## Answer

**One budget, shared.** A task started in `EdgeRuntime.waitUntil` continues to
draw on the CPU budget the request was already spending. It does not get a fresh
2 s, and the total across request and background task is what the limit applies
to.

## Method

A throwaway Edge Function, deployed with `--no-verify-jwt`, that burns CPU for a
requested number of milliseconds inside the request, inside `waitUntil`, or
split across both, logging every 250 ms. `addEventListener("beforeunload")`
captures the shutdown reason; `CPU Time exceeded` is the signature, and the
caller sees HTTP 546 with `{"code":"WORKER_RESOURCE_LIMIT"}`.

The first version burned CPU in a tight synchronous loop, which turned out to
measure the wrong thing (see caveats). The numbers below come from the yielding
version, which returns to the event loop every 20 ms.

## Results

Background task alone, yielding, by requested burn:

| Requested burn | Outcome | Died at |
| --- | --- | --- |
| 2 000 ms | completed | — |
| 5 000 ms | `CPU Time exceeded` | 2 009 ms |
| 20 000 ms | `CPU Time exceeded` | 2 016 ms |
| 60 000 ms | `CPU Time exceeded` | 2 003 ms |

The cliff sits at 2 s regardless of how much work was asked for, and a 60 s task
dies in the same place as a 5 s one.

Split across the request and the background task — 1 000 ms burned in the
request, then a 5 000 ms background task, three consecutive runs:

| Run | Request | Background reached | Combined |
| --- | --- | --- | --- |
| 1 | 1 001 ms | 1 000 ms | ~2.00 s |
| 2 | 1 000 ms | 1 256 ms | ~2.26 s |
| 3 | 1 002 ms | 1 259 ms | ~2.26 s |

A background task that gets ~2.01 s on its own gets only ~1.0–1.26 s once the
request has already spent a second. The budget is shared, and the request's
spend comes off the top.

## The response is not decoupled by `waitUntil` alone

Worth recording because it is the trap that made the first measurement
meaningless. With a **synchronous** background loop, the caller's response is
not delivered until the loop ends — latency tracked the burn exactly:

| Background burn | Response |
| --- | --- |
| 0 ms | 200 in 0.345 s |
| 500 ms | 200 in 0.810 s |
| 1 500 ms | 200 in 1.827 s |
| 2 000 ms | **546** in 2.136 s |

`Deno.serve` had already returned a `Response`; a CPU-bound synchronous loop
starves the single-threaded isolate so the response can never flush. At 2 000 ms
the worker was killed before it did, and the caller received 546 for a request
whose handler had returned successfully — an already-successful response turned
into an error by work happening after it.

Yielding every 20 ms fixes the delivery: the same 20 s background task returns
its response in 0.34 s. It does not buy any more CPU.

## Caveats

**A synchronous loop is not preempted precisely.** Where the yielding runs died
at a tight 2.00–2.02 s, synchronous runs overshot unpredictably — 3.0 s for a
background-only burn, and one split run reached ~9 s combined before dying. The
runtime appears unable to interrupt a tight loop without a yield point. This
overshoot is not a budget and must not be planned against; it varied by 3× across
runs.

**Wall clock never bound.** Nothing here died of the 150 s Free-plan wall-clock
limit. Every death was CPU.

**Memory was not measured.** Issue 15's 150 MB planning figure is untouched by
this.

## What it means for the Upload

ADR-0009's synchronous preview was already dead. This kills the most attractive
replacement too: **stream the zip to `/tmp`, unzip and parse inside
`waitUntil`, return an id and poll** does not work, because the background task
gets the same 2 s the synchronous version would have had. Moving the work after
the response changes when the caller hears back, not how much CPU the work may
use.

The remaining shapes for the preview are unchanged in number: split the work
across several invocations, each with its own 2 s, or run it somewhere that is
not an Edge Function. Issue 16 chooses.

## Reproducing

The function is not kept. It was deployed as `cpu-budget`, exercised over plain
`curl`, and deleted. Logs came from the Management API rather than the CLI, which
no longer has a `functions logs` subcommand as of 2.114.0:

```
GET https://api.supabase.com/v1/projects/<ref>/analytics/endpoints/logs.all
  ?sql=select function_logs.timestamp, event_message from function_logs
       order by timestamp desc limit 200
```
