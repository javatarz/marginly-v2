# Multi-tenant from day one, hosted and self-hostable

The data model carries Author ownership and Book membership from the first
commit, so a single deployment can serve unrelated Authors. We run a hosted
instance for Authors who will never operate a server, and the same code is
self-hostable by anyone who wants to.

## Considered Options

A single-tenant, self-host-first build would have removed tenancy scoping,
signup, and abuse handling entirely, and is a coherent FOSS product. It was
rejected because the intended users are novelists, who will not deploy
software — a self-host-only tool reaches developers who happen to write, and
few others. Retrofitting tenancy later is among the more expensive rewrites
available.

## Consequences

Every query is scoped by owner, and that discipline has to hold from the
start. No proprietary managed service may sit on the critical path, or
self-hosting stops being real — this constrains stack choices for storage,
search, and auth.
