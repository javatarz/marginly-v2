# Ingest sanitised third-party HTML

Authors write in Markdown or AsciiDoc and build their own HTML with whatever
toolchain they already use, so Marginly accepts rendered HTML rather than
source. We sanitise every Publish and derive our own Block identity from
content, ignoring any ids the incoming document supplies.

## Considered Options

Taking Markdown/AsciiDoc source and rendering server-side was the alternative.
It would have given us exact control over structure and anchors, but it forces
us to carry an AsciiDoc toolchain and a Markdown flavour matrix forever, and
it breaks Authors whose pipelines have extensions we don't support. Shipping
our own build CLI to guarantee canonical output was also considered and
rejected as too constraining on the Author's existing setup.

## Consequences

Incoming ids are untrustworthy, so Anchors cannot be a lookup — they must be
resolved by content matching on every Publish (see ADR-0002). Rendering
another user's HTML into a Reviewer's browser makes sanitisation a permanent
security surface rather than a one-off task.
