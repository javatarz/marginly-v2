-- Uploading a Version, straight through (#25) — the tracer bullet ADR-0009 and ADR-0015
-- describe, without the preview/confirm split #26 adds on top of it.
--
-- ADR-0009: the confirm's writes — the `latest_version_number` bump and the `versions`
-- insert — run in one transaction on a raw Postgres connection through Supavisor in
-- transaction mode, as the Author, under `set local role` and `set local
-- request.jwt.claims`. That needs a database role to connect as, and ADR-0009 is explicit
-- that it must be privilege-free: it owns nothing and is granted nothing directly, so a
-- path that forgets to `set local role` gets a permission error rather than bypassing RLS.
--
-- `noinherit` is what makes membership in `authenticated` inert until a caller explicitly
-- switches into it — the same shape Postgres's own `authenticator` role uses for
-- PostgREST. Nothing here sets its password: that is an environment-specific secret
-- (CODING_STANDARDS.md §4) and belongs in `supabase/seed.sql` for the local stack and in
-- an operator's own hands for a deployed one, never in a migration `db push` would carry
-- to production verbatim.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'edge_functions') then
    create role edge_functions with login noinherit;
  end if;
end
$$;

grant authenticated to edge_functions;

-- A Version. Immutable, numbered one past the Book it belongs to, and holding nothing
-- about its content: the HTML and the extracted text live in Storage, at the prefix this
-- row's own (book_id, version_number) computes — never a path a caller supplies.
create table public.versions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  version_number int not null check (version_number > 0),
  created_at timestamptz not null default now(),
  unique (book_id, version_number)
);

create index versions_book_id_idx on public.versions (book_id);

-- ADR-0010's three obligations: book_id (above), RLS enabled, policies written.
alter table public.versions enable row level security;

revoke all on public.versions from anon, authenticated;
grant select, insert on public.versions to authenticated;

create policy "a Version is read by whoever may read its Book"
  on public.versions
  for select
  to authenticated
  using (public.can_read_book(book_id));

create policy "an Author lands a Version on their own Book"
  on public.versions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.author_id = (select auth.uid())
    )
  );

-- No update or delete grant at all: the surest way to keep a Version immutable is to
-- give no path to a caller in the first place. The triggers below are the second guard —
-- for the raw connection's own writes, not just PostgREST's.

-- ADR-0010: "RLS must let an Author write a Version" — the bump runs as the Author, under
-- their own JWT, so `books` needs an update policy it did not have before this ticket.
-- Column-scoped, the same way ADR-0010 scopes `thread_versions`' Resolve column: only
-- `latest_version_number` is grantable, and nothing else on the row.
grant update (latest_version_number) on public.books to authenticated;

create policy "an Author bumps their own Book's Version counter"
  on public.books
  for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- Numbered one past the latest. The bump above runs first in the same transaction, so by
-- the time this fires, `books.latest_version_number` already holds the number this row
-- must match — not one more than it. `security invoker`, deliberately: the inserting role
-- already holds `select` on its own Book by the ordinary policy above, so nothing here
-- needs to see past RLS.
create function public.enforce_version_numbering()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest int;
begin
  select latest_version_number into latest
  from public.books
  where id = new.book_id;

  if new.version_number is distinct from latest then
    raise exception
      'a Version must be numbered one past the latest (Book % is at %, got %)',
      new.book_id, latest, new.version_number;
  end if;

  return new;
end;
$$;

create trigger enforce_version_numbering
  before insert on public.versions
  for each row
  execute function public.enforce_version_numbering();

-- Immutable. Belt and braces alongside the missing update/delete grant above: this is
-- what stops the raw connection's own writes too, since that connection's whole reason
-- to exist is to do things PostgREST's grants do not describe.
create function public.versions_are_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a Version is immutable';
end;
$$;

create trigger versions_are_immutable
  before update or delete on public.versions
  for each row
  execute function public.versions_are_immutable();

-- Two private buckets (ADR-0010), governed by policies on `storage.objects` rather than
-- by a route holding the master key. Both name the Book first, so
-- `(storage.foldername(storage.objects.name))[1]` is the one expression both policy sets
-- below read the Book id from:
--
--   Versions: {book_id}/{version_number}/index.html, assets beside it at their
--   original relative paths. Readable when `can_read_book` says so, writable only by
--   the Book's Author.
--
--   Staging:  {book_id}/…. The Author's alone — no Reviewer clause at all.
--
-- Schema-qualified as `storage.objects.name` throughout, deliberately, rather than the
-- bare column: `books` has its own `name` column (the Book's title), and inside the
-- `exists (select … from public.books b where …)` subqueries below, a bare `name` is in
-- the inner query's scope — Postgres resolves it to `b.name`, not to the object's path,
-- silently. That reads as a policy and passes review; it only fails at the row.
insert into storage.buckets (id, name, public)
values ('versions', 'versions', false), ('staging', 'staging', false)
on conflict (id) do nothing;

create policy "a Version's Storage objects are read by whoever may read the Book"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'versions'
    and public.can_read_book(((storage.foldername(storage.objects.name))[1])::uuid)
  );

-- Insert only. A Version's objects are never updated or deleted once written — the same
-- immutability the table triggers enforce, carried into Storage.
create policy "an Author writes their own Book's Version objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'versions'
    and exists (
      select 1 from public.books b
      where b.id = ((storage.foldername(storage.objects.name))[1])::uuid
        and b.author_id = (select auth.uid())
    )
  );

-- Staging is transient and the Author's alone: read, write and clear it freely, but only
-- under their own Book's prefix, and only ever their own.
create policy "an Author alone reads and writes their own Book's staging objects"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'staging'
    and exists (
      select 1 from public.books b
      where b.id = ((storage.foldername(storage.objects.name))[1])::uuid
        and b.author_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'staging'
    and exists (
      select 1 from public.books b
      where b.id = ((storage.foldername(storage.objects.name))[1])::uuid
        and b.author_id = (select auth.uid())
    )
  );
