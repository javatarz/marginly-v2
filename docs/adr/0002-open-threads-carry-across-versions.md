# Open Threads carry across Versions

A Book is edited outside Marginly and every Upload creates a new Version, so the
text under a Thread changes without the platform seeing it happen. An Open
Thread is nevertheless **carried into each new Version**, staying beside the
Highlight it was rooted on, rather than belonging only to the Version it was started
on. Resolving a Thread ends the carry: a Thread Resolved while v5 was the latest
Version is visible on v2–v5 and absent from v6 onward.

## Considered Options

The alternative was **Version-scoped Threads** — a Thread belongs to its
Version, every Upload starts with an empty margin, and continuing an old
discussion means opening the old Version to reply there. It is close to free: a
Thread would store a Version and a Highlight reference valid only inside it, and no
Highlight would ever need identifying across Versions. It is also the literal
reading of `Readme.md:6`.

It was rejected because the discussion dies at every Upload. An Author who
rewrites a paragraph *because* of feedback ships the next Version and finds that
feedback is no longer beside the text it changed, and a conversation spanning
several Uploads ends up shredded across Versions by nothing but timing.

## Consequences

This commits the build to **identifying a Highlight across Versions** — surviving
the Highlight being reworded, moved to another chapter, split, merged with a
neighbour, or deleted outright. That machinery is the single largest unknown in
the project and the reason Highlight identity is the first decision on the map. It
is a cost that Version-scoped Threads would have avoided entirely; every other
difference between the models is small next to it.
