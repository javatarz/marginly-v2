-- Link, move and unlink a Thread (#35) — ADR-0002/0003/0004/0006/0010/0014.
--
-- Three writes on the latest Version, all confined to it by the same shape every other
-- latest-Version mutation in this schema uses: rows -> `can_read_book` (both roles alike,
-- ADR-0014 amends "wherever a Reviewer drags it" to either role), columns -> a narrow
-- grant, timing -> a trigger. Link and move fit that shape exactly; unlink's write spans
-- two tables, so it is a `security definer` function instead (see its own comment below)
-- rather than a second grant.
--
-- Link and move are the same write: setting `thread_versions`' current-latest row to
-- `status = 'linked'` at a new `text_position`, whether the row was previously Unlinked
-- (a link) or already Linked somewhere else (a move). Both are a single-table,
-- single-row update, so — like #30's `editComment`/`deleteComment` — they need no RPC:
-- the grant and policy below are the whole write path, exercised directly by
-- `linkThread` in threads-api.ts through `.from('thread_versions').update(...)`.
grant update (status, text_position, thread_position) on public.thread_versions to authenticated;

create policy "a Thread's per-Version row is moved by whoever may read the Book"
  on public.thread_versions
  for update
  to authenticated
  using (public.can_read_book(book_id))
  with check (public.can_read_book(book_id));

-- "Only on the latest Version" (ADR-0003/0004), mirroring
-- `enforce_thread_version_matches_latest`'s insert-time check
-- (20260814040000_start_a_thread.sql) but for the update path the grant above just
-- opened. `old.version_number`: a `thread_versions` row's own `version_number` never
-- changes (the grant above does not include it), so `old` and `new` agree here by
-- construction — this checks the row being written, not a value a caller could forge.
create function public.enforce_thread_version_update_on_latest()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest int;
begin
  select latest_version_number into latest from public.books where id = old.book_id;

  if old.version_number is distinct from latest then
    raise exception
      'a Thread may be linked, moved or unlinked only on the latest Version (Book % is at %, got %)',
      old.book_id, latest, old.version_number;
  end if;

  return new;
end;
$$;

create trigger enforce_thread_version_update_on_latest
  before update on public.thread_versions
  for each row
  execute function public.enforce_thread_version_update_on_latest();

-- Deliberate unlinking discards the Thread's matching text (ADR-0004: "not sticky" is
-- the Upload's own automatic Unlink alone; a reader's own gesture stays Unlinked until
-- linked by hand). `selected_text`/`paragraph_text` were `not null` from #29's migration,
-- written once at creation and never touched since — this is their first writer, and the
-- first thing that can make them absent.
alter table public.threads
  alter column selected_text drop not null,
  alter column paragraph_text drop not null;

alter table public.threads
  add constraint threads_text_pairing check ((selected_text is null) = (paragraph_text is null));

-- No grant on `threads` for this: unlike `thread_versions` above, discarding matching
-- text is never safe as a standalone write — a caller who nulled `selected_text` and
-- `paragraph_text` without also flipping `thread_versions.status` in the same statement
-- would leave a Thread that still renders Linked (with a Highlight) while silently
-- primed to Unlink on the next Upload, since the match seam treats `text: null` as
-- discarded regardless of the row it is currently reading. `threads` grants no update to
-- `authenticated` at all — the same reasoning `resolve_thread` gives for
-- `resolved_version_number` — so `unlink_thread` below is the only writer, and reaches
-- both tables through its own elevated privilege rather than the caller's.

-- Unlink is the one write that touches two tables — `thread_versions`' current-latest row
-- and, when the Thread was Linked a moment ago, `threads`' own matching text — and
-- PostgREST gives one transaction per HTTP request, so (like `start_thread`) it needs a
-- function to land both or neither. `security definer`, because there is no grant on
-- `threads` for a caller's own privilege to reach: the explicit `can_read_book` check
-- below is this function's own re-implementation of the row check a policy would
-- otherwise have made — the same "hole in its own boundary" `resolve_thread` and
-- `grant_access` already are.
--
-- Whether text is discarded turns on the row's own prior status, not on anything the
-- caller states: dragging an already-Unlinked Thread to a new place in the margin is a
-- reposition and must keep whatever matching text it still carries (an Upload-time Unlink
-- is retried on every later Upload, ADR-0004); dragging a Linked Thread into the margin is
-- the deliberate correction that discards it. Reading `was_linked` from the database
-- itself, inside this same statement, is what keeps that distinction honest.
create function public.unlink_thread(thread uuid, placement int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_book uuid;
  latest int;
  was_linked boolean;
begin
  select book_id into target_book from public.threads where id = thread;

  if target_book is null or not public.can_read_book(target_book) then
    raise exception 'no such Thread';
  end if;

  select latest_version_number into latest from public.books where id = target_book;

  select (status = 'linked') into was_linked
  from public.thread_versions
  where thread_id = thread and book_id = target_book and version_number = latest;

  if was_linked is null then
    raise exception 'this Thread has no row on the latest Version';
  end if;

  if was_linked then
    update public.threads
    set selected_text = null, paragraph_text = null
    where id = thread;
  end if;

  update public.thread_versions
  set status = 'unlinked', text_position = null, thread_position = placement
  where thread_id = thread and book_id = target_book and version_number = latest;
end;
$$;

revoke all on function public.unlink_thread(uuid, int) from public;
grant execute on function public.unlink_thread(uuid, int) to authenticated;

-- `version_threads` (ADR-0006's shared read) gains `rooted_text` — ADR-0014's "an
-- Unlinked Thread shows the text it kept": `threads.selected_text`, null exactly when a
-- reader has deliberately discarded it. The return shape changed, so dropped and
-- recreated rather than `create or replace`d, the same reason #34's migration gives.
drop function public.version_threads(uuid, int);

create function public.version_threads(book uuid, version_number int)
returns table (
  thread_id uuid,
  created_by uuid,
  created_at timestamptz,
  status text,
  text_position int4range,
  thread_position int4,
  rooted_text text,
  resolved boolean,
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
    tv.status,
    tv.text_position,
    tv.thread_position,
    t.selected_text,
    t.resolved_version_number is not null
      and t.resolved_version_number <= version_threads.version_number as resolved,
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
        and c.version_number <= version_threads.version_number
    ) as comments
  from public.thread_versions tv
  join public.threads t on t.id = tv.thread_id and t.book_id = tv.book_id
  where tv.book_id = version_threads.book
    and tv.version_number = version_threads.version_number;
$$;

revoke all on function public.version_threads(uuid, int) from public;
grant execute on function public.version_threads(uuid, int) to authenticated;
