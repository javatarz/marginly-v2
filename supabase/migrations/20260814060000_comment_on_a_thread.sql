-- Commenting on a Thread (#30) — ADR-0006/ADR-0010.
--
-- #29 gave `comments` `select, insert` only, on purpose: editing and deleting were a
-- later ticket's job (see that migration's header). This is that ticket. Adding a
-- Comment to an existing Thread reuses #29's own insert policy and its
-- `enforce_comment_written_on_latest_version` trigger unchanged — `add_comment` below
-- exists only to spare the caller from looking up the Thread's `book_id` and the
-- Book's current latest Version themselves, the same reason `start_thread` computes
-- its own `version_number` rather than accepting one.
--
-- Editing and deleting are new grants, each following ADR-0010's "rows, columns and
-- timing are three different questions": a column privilege limits an edit to `body`
-- alone, a policy limits both to whoever wrote the Comment, and a trigger — mirroring
-- #29's own latest-Version enforcement, extended from insert to update and delete —
-- refuses either once the Comment's Version is no longer the Book's latest.

grant update (body) on public.comments to authenticated;
grant delete on public.comments to authenticated;

create policy "whoever wrote a Comment may edit it"
  on public.comments
  for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy "whoever wrote a Comment may delete it"
  on public.comments
  for delete
  to authenticated
  using (author_id = (select auth.uid()));

create function public.enforce_comment_edited_on_latest_version()
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
      'a Comment may be edited only while its Version is the latest (Book % is at %, Comment is on %)',
      old.book_id, latest, old.version_number;
  end if;

  return new;
end;
$$;

create trigger enforce_comment_edited_on_latest_version
  before update on public.comments
  for each row
  execute function public.enforce_comment_edited_on_latest_version();

create function public.enforce_comment_deleted_on_latest_version()
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
      'a Comment may be deleted only while its Version is the latest (Book % is at %, Comment is on %)',
      old.book_id, latest, old.version_number;
  end if;

  return old;
end;
$$;

create trigger enforce_comment_deleted_on_latest_version
  before delete on public.comments
  for each row
  execute function public.enforce_comment_deleted_on_latest_version();

-- "Deleting the last Comment in a Thread deletes the Thread" (ADR-0006): a Thread is
-- started by writing its first Comment (`enforce_thread_has_a_comment`), and an empty
-- Thread is not a state `Readme.md` has, so removing the last Comment removes the
-- Thread it was the last of. `security definer`, deliberately: `threads` grants no
-- delete privilege to `authenticated` at all (a Thread is never deleted directly, only
-- as this side effect), so the invoking role could not perform this delete on its own
-- privileges — the same reasoning that makes `grant_access` a definer function. The
-- comment whose removal triggers this has already passed the ordinary delete policy
-- and the latest-Version trigger above, so by the time this runs the deletion it is
-- reacting to was already authorised. `thread_versions`' and `comments`' own foreign
-- keys to `threads(id, book_id)` are `on delete cascade`, so deleting the Thread row
-- here is the only delete this needs to issue.
create function public.enforce_thread_deleted_when_last_comment_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.comments where thread_id = old.thread_id) then
    delete from public.threads where id = old.thread_id;
  end if;

  return old;
end;
$$;

create trigger enforce_thread_deleted_when_last_comment_removed
  after delete on public.comments
  for each row
  execute function public.enforce_thread_deleted_when_last_comment_removed();

-- Adding a Comment to a Thread that already exists. `security invoker`: the insert it
-- performs is checked against the caller's own privileges by the ordinary insert
-- policy and the latest-Version trigger, exactly as a direct insert would be — this
-- function only spares the caller from supplying `book_id` (looked up from the
-- Thread) and `version_number` (the Book's current latest), neither of which the
-- caller is trusted to supply correctly (ADR-0006). A caller naming a Thread they may
-- not read gets `target_book` as null, since RLS already hides that row from them —
-- the insert that follows would refuse it a second time regardless.
create function public.add_comment(thread uuid, body text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_book uuid;
  latest int;
  new_comment_id uuid;
begin
  select book_id into target_book from public.threads where id = thread;

  if target_book is null then
    raise exception 'no such Thread';
  end if;

  select latest_version_number into latest from public.books where id = target_book;

  insert into public.comments (thread_id, book_id, author_id, version_number, body)
  values (thread, target_book, (select auth.uid()), latest, body)
  returning id into new_comment_id;

  return new_comment_id;
end;
$$;

revoke all on function public.add_comment(uuid, text) from public;
grant execute on function public.add_comment(uuid, text) to authenticated;
