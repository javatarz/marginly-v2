-- Confirm an Upload from its preview (#26) — ADR-0008/0009/0015's preview/confirm split,
-- layered onto the straight-through tracer bullet #25 already built.
--
-- ADR-0015: an Upload whose hash matches the latest Version is refused outright, and "the
-- comparison happens here and only here". That needs the latest Version's hash to compare
-- against, and nothing before this ticket stored one.
alter table public.versions add column hash text not null;
