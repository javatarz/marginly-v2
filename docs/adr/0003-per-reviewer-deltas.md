# Deltas are per-Reviewer, against a Last-seen Version

Marginly holds a Last-seen Version per Reviewer per Book, and computes each
Delta between that Version and the latest one. Two Reviewers opening the same
Book at the same moment can therefore see different Deltas.

## Considered Options

One global "changed since the previous Version" diff would be simpler,
cacheable, and computed once per Publish. It was rejected because a Reviewer
returning after three Publishes would be shown only the most recent change and
would silently miss everything in between — which defeats the product's core
promise.

## Consequences

Diffs must be computable between arbitrary Version pairs, not just consecutive
ones. Reviewers advance to the latest Version on open, never mid-session, so
text never shifts under someone who is reading.
