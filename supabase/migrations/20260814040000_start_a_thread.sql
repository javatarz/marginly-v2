-- Starting a Thread: the Highlight and the margin (#29) — ADR-0002/0003/0004/0006/0010/0014.
--
-- Three tables. `threads` is a Thread's durable identity: who started it, which Version
-- was latest when they did, and the two matching inputs ADR-0004 asks for (the selected
-- text and its containing paragraph's text) — captured now because this is the only
-- moment they are available, even though nothing reads them back until a later ticket's
-- Upload-time matching. `thread_versions` is ADR-0006's schema verbatim, narrowed by
-- ADR-0014. `comments` carries `book_id` pinned to its Thread by a foreign key to
-- `threads(id, book_id)` (ADR-0010), so the two can never name different Books.
--
-- This ticket only ever creates a Linked Thread from a live selection — Unlinking,
-- re-linking and Resolve are later tickets' Upload-time and reader-driven mutations, so
-- `threads` carries no `resolved_version_number` yet and `thread_versions` grants no
-- update at all. Both arrive with the tickets that need them; adding a nullable column or
-- a column privilege later costs nothing on rows already written.

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_version_number int not null,
  selected_text text not null,
  paragraph_text text not null,
  created_at timestamptz not null default now(),
  -- Referenced by thread_versions(thread_id, book_id) and comments(thread_id, book_id)
  -- below (ADR-0010) — Postgres needs the composite unique constraint even though `id`
  -- alone is already unique.
  unique (id, book_id),
  foreign key (book_id, created_version_number) references public.versions (book_id, version_number)
);

create index threads_book_id_idx on public.threads (book_id);

-- ADR-0006's schema, with ADR-0014's int4/int4range narrowing, unchanged.
create table public.thread_versions (
  thread_id uuid not null,
  book_id uuid not null,
  version_number int not null,
  status text not null check (status in ('linked', 'unlinked')),
  text_position int4range,
  thread_position int4,
  primary key (thread_id, version_number),
  foreign key (thread_id, book_id) references public.threads (id, book_id) on delete cascade,
  foreign key (book_id, version_number) references public.versions (book_id, version_number),
  check ((status = 'linked') = (text_position is not null)),
  check ((status = 'unlinked') = (thread_position is not null)),
  -- Not in ADR-0006's text, but implied by what a Highlight is: a passage, never an
  -- empty point. `isempty` rather than `lower(...) < upper(...)`: both bounds of an
  -- empty range read back as null, which a `<` comparison would pass through as null —
  -- satisfying the check rather than failing it.
  check (status <> 'linked' or not isempty(text_position))
);

create index thread_versions_book_version_idx on public.thread_versions (book_id, version_number);

-- A single message within a Thread. `version_number` is computed at insert, never
-- supplied (ADR-0006) — the trigger below checks it rather than trusting a caller's
-- value, and the RPC that is the only writer never passes anything but the true latest.
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  book_id uuid not null,
  author_id uuid not null references auth.users (id) on delete cascade,
  version_number int not null,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  foreign key (thread_id, book_id) references public.threads (id, book_id) on delete cascade,
  foreign key (book_id, version_number) references public.versions (book_id, version_number)
);

create index comments_thread_id_idx on public.comments (thread_id);

-- ADR-0010's three obligations on every table under a Book: book_id (above), RLS
-- enabled, policies written.
alter table public.threads enable row level security;
alter table public.thread_versions enable row level security;
alter table public.comments enable row level security;

revoke all on public.threads from anon, authenticated;
revoke all on public.thread_versions from anon, authenticated;
revoke all on public.comments from anon, authenticated;

-- Select and insert only. No update or delete grant on any of the three: a Thread's
-- identity never changes after it starts, a `thread_versions` row is frozen the moment a
-- later Version lands, and editing or deleting a Comment is a later ticket. The surest
-- way to keep a row immutable is to give no path to a caller in the first place, the same
-- reasoning `versions` already uses.
grant select, insert on public.threads to authenticated;
grant select, insert on public.thread_versions to authenticated;
grant select, insert on public.comments to authenticated;

create policy "a Thread is read by whoever may read its Book"
  on public.threads
  for select
  to authenticated
  using (public.can_read_book(book_id));

-- "Only by someone who can read the Book" is `can_read_book`; there is no further role
-- check, because starting a Thread is a Reviewer's act and an Author's alike.
create policy "anyone who may read a Book may start a Thread on it"
  on public.threads
  for insert
  to authenticated
  with check (public.can_read_book(book_id) and created_by = (select auth.uid()));

create policy "a Thread's per-Version rows are read by whoever may read the Book"
  on public.thread_versions
  for select
  to authenticated
  using (public.can_read_book(book_id));

create policy "a Thread's per-Version row is written by whoever may read the Book"
  on public.thread_versions
  for insert
  to authenticated
  with check (public.can_read_book(book_id));

create policy "a Comment is read by whoever may read its Book"
  on public.comments
  for select
  to authenticated
  using (public.can_read_book(book_id));

create policy "anyone who may read a Book may write a Comment on it"
  on public.comments
  for insert
  to authenticated
  with check (public.can_read_book(book_id) and author_id = (select auth.uid()));

-- "Only on the latest Version" (ADR-0006/ADR-0010), for each of the three tables' own
-- insert. `security invoker`, deliberately: the inserting role already holds `select` on
-- its own Book by the ordinary policies above, so nothing here needs to see past RLS —
-- the same reasoning `enforce_version_numbering` (20260813200001_upload_a_version.sql)
-- already uses.
create function public.enforce_thread_started_on_latest_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest int;
begin
  select latest_version_number into latest from public.books where id = new.book_id;

  if new.created_version_number is distinct from latest then
    raise exception
      'a Thread may be started only on the latest Version (Book % is at %, got %)',
      new.book_id, latest, new.created_version_number;
  end if;

  return new;
end;
$$;

create trigger enforce_thread_started_on_latest_version
  before insert on public.threads
  for each row
  execute function public.enforce_thread_started_on_latest_version();

create function public.enforce_thread_version_matches_latest()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest int;
begin
  select latest_version_number into latest from public.books where id = new.book_id;

  if new.version_number is distinct from latest then
    raise exception
      'a Thread''s per-Version row may be written only for the latest Version (Book % is at %, got %)',
      new.book_id, latest, new.version_number;
  end if;

  return new;
end;
$$;

create trigger enforce_thread_version_matches_latest
  before insert on public.thread_versions
  for each row
  execute function public.enforce_thread_version_matches_latest();

create function public.enforce_comment_written_on_latest_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest int;
begin
  select latest_version_number into latest from public.books where id = new.book_id;

  if new.version_number is distinct from latest then
    raise exception
      'a Comment may be written only on the latest Version (Book % is at %, got %)',
      new.book_id, latest, new.version_number;
  end if;

  return new;
end;
$$;

create trigger enforce_comment_written_on_latest_version
  before insert on public.comments
  for each row
  execute function public.enforce_comment_written_on_latest_version();

-- "A Thread is started by writing its first Comment; there is no empty Thread." A
-- `before insert` trigger on `threads` cannot see this — the Comment does not exist yet
-- inside the same statement — so this is a deferred constraint trigger, checked at
-- commit rather than per-row. `start_thread` below inserts the Comment in the same
-- transaction, so an ordinary call passes; a caller who inserts a bare `threads` row
-- through the API with no Comment to follow gets a rollback rather than a silent orphan.
create function public.enforce_thread_has_a_comment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.comments where thread_id = new.id) then
    raise exception 'a Thread must be started by writing its first Comment';
  end if;

  return new;
end;
$$;

create constraint trigger enforce_thread_has_a_comment
  after insert on public.threads
  deferrable initially deferred
  for each row
  execute function public.enforce_thread_has_a_comment();

-- The one write path a Reviewer or Author actually calls. `security invoker`: every
-- insert below is checked against the caller's own privileges by the policies just
-- written, so there is no hole to justify `security definer` — the only reason this is a
-- function at all is that a Thread, its first per-Version row and its first Comment have
-- to land in one transaction or not at all, and PostgREST gives one transaction per HTTP
-- request rather than per RPC call plus a follow-up insert.
--
-- `version_number` is read here, not accepted as a parameter, so nothing about which
-- Version this lands on is ever supplied by the caller — the triggers above are the
-- second guard, for a caller that skips this function entirely.
create function public.start_thread(
  book uuid,
  range_start int,
  range_end int,
  selected_text text,
  paragraph_text text,
  body text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  latest int;
  new_thread_id uuid;
begin
  if range_end <= range_start then
    raise exception 'a Highlight must cover at least one character';
  end if;

  select latest_version_number into latest from public.books where id = book;

  insert into public.threads (book_id, created_by, created_version_number, selected_text, paragraph_text)
  values (book, (select auth.uid()), latest, selected_text, paragraph_text)
  returning id into new_thread_id;

  insert into public.thread_versions (thread_id, book_id, version_number, status, text_position)
  values (new_thread_id, book, latest, 'linked', int4range(range_start, range_end));

  insert into public.comments (thread_id, book_id, author_id, version_number, body)
  values (new_thread_id, book, (select auth.uid()), latest, body);

  return new_thread_id;
end;
$$;

revoke all on function public.start_thread(uuid, int, int, text, text, text) from public;
grant execute on function public.start_thread(uuid, int, int, text, text, text) to authenticated;

-- The one shared read for a Version's discussion (issue #18's "The database"). `security
-- invoker`, `stable`: every row it touches is already gated by the policies above, so
-- reading it as the caller is both correct and simpler than a definer function that
-- would have to re-check `can_read_book` by hand. This ticket creates only Linked
-- Threads with exactly one Comment apiece, so it returns `text_position` and the full
-- Comment list rather than also carrying ADR-0003's cut-off or ADR-0006's visible-range
-- predicate — neither has anything to filter yet, and both arrive with the tickets that
-- give them a Thread to filter.
create function public.version_threads(book uuid, version_number int)
returns table (
  thread_id uuid,
  created_by uuid,
  created_at timestamptz,
  text_position int4range,
  comments jsonb
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    t.id,
    t.created_by,
    t.created_at,
    tv.text_position,
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'author_id', c.author_id,
          'body', c.body,
          'created_at', c.created_at
        )
        order by c.created_at
      )
      from public.comments c
      where c.thread_id = t.id
    ) as comments
  from public.thread_versions tv
  join public.threads t on t.id = tv.thread_id and t.book_id = tv.book_id
  where tv.book_id = version_threads.book
    and tv.version_number = version_threads.version_number
    and tv.status = 'linked';
$$;

revoke all on function public.version_threads(uuid, int) from public;
grant execute on function public.version_threads(uuid, int) to authenticated;
