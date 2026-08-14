-- Carrying Open Threads into a new Version (#33) needs the Thread set it reads inside
-- its own transaction to be the true, fully-committed set — but `start_thread`'s read of
-- `latest_version_number` (#29) was a plain SELECT. Under READ COMMITTED, a plain SELECT
-- ignores another transaction's uncommitted row lock: `upload-confirm`'s bump
-- (`update books set latest_version_number = ... where id = ...`) takes an exclusive
-- lock on the Book's row but does not block a concurrent `start_thread` call from
-- reading the pre-bump number and committing its Thread's first `thread_versions` row
-- immediately after, while the confirm's own read of the Open Thread set has already
-- run in the same transaction. That Thread's only row then sits on a Version that is no
-- longer latest by the time its own insert lands, and no future confirm ever looks at a
-- non-latest Version's rows again — an orphan with no way back.
--
-- `select ... for share` on `books` was tried first and reverted: Postgres only honours
-- a locking SELECT for the rows an UPDATE (or ALL) policy would also let the caller
-- touch, and `books`' own update policy ("an Author bumps their own Book's Version
-- counter") names the Author alone — a Reviewer's `for share` read comes back with no
-- row at all, silently, `latest_version_number` reads as null, and every Reviewer-started
-- Thread breaks. An advisory lock sits outside RLS entirely, so it serializes both an
-- Author's and a Reviewer's `start_thread` call against the confirm's own transaction
-- without needing either grant. Keyed by the Book id under a fixed class id, so it can
-- never collide with an advisory lock some later, unrelated feature takes out for its
-- own reasons.
create or replace function public.start_thread(
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

  perform pg_advisory_xact_lock(847001001, hashtext(book::text));

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
