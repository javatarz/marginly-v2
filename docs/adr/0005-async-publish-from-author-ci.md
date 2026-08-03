# Publish is asynchronous, driven by the Author's CI

Publishing is machine-to-machine: the Author's own build — in CI or on their
machine — pushes rendered HTML to Marginly with an API credential. The push
returns a publish id immediately; sanitising, segmenting into Blocks, diffing
against the previous Version, and re-resolving every Anchor run as queued
stages. The client polls until the Version is live or has failed, so a build
still goes red when a Publish does not take.

## Considered Options

A fully synchronous endpoint is a simpler contract and correct for short
books. It was rejected because the backend runs on Supabase Edge Functions,
whose CPU budget will not reliably cover a full-length novel with hundreds of
Threads — and the resulting failure is a timeout, the least informative error
available.

## Consequences

A Version becomes visible to Reviewers atomically, only once every Anchor has
been resolved. A partially processed Publish must never be readable, or
Reviewers open it to find Threads missing or pointing at the wrong words.

The publish endpoint is a contract with the Author's build pipeline, so its
wire format and credential model need versioning from the start — they are
expensive to change once Authors have wired them into CI.
