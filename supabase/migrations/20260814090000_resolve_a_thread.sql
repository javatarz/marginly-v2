-- Resolving a Thread (#31) — ADR-0002/0003/0006/0010.
--
-- ADR-0006: a Thread's visible range is two integers, `created_version_number` and,
-- once Resolved, `resolved_version_number`. State is derived from the second one
-- rather than stored per Version, which only works because a Thread is never
-- reopened — so this column is set once and the trigger below is the enforcement of
-- that, not just documentation of it.
--
-- ADR-0010: *rows*, *columns* and *timing* are three different rules here. Rows —
-- "only this Thread" — is the `security definer` lookup inside `resolve_thread`
-- itself; timing — "only on the latest Version" — is the trigger, mirroring every
-- other latest-Version trigger in this schema; columns — "only the Author" — is
-- deliberately **not** a policy. `threads` grants no `update` to `authenticated` at
-- all (#29), so a policy expressing "Author only" would, for a Reviewer, match zero
-- rows and report success — a silent no-op where a refusal belongs. `resolve_thread`
-- raises instead, and reaches `threads` only through its own elevated privilege.

alter table public.threads
  add column resolved_version_number int,
  add foreign key (book_id, resolved_version_number) references public.versions (book_id, version_number);

-- "A resolution is set once and never cleared" (ADR-0006), enforced against any writer
-- that reaches this row directly — `resolve_thread` below included, since a trigger
-- fires regardless of who or what performs the update. Also refuses a resolution Version
-- that is not the Book's own latest, the same timing rule every other mutation here
-- keeps.
create function public.enforce_thread_resolved_once_and_on_latest()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest int;
begin
  if old.resolved_version_number is not null then
    raise exception
      'a Thread''s resolution cannot be cleared or moved (Thread % was Resolved on %)',
      old.id, old.resolved_version_number;
  end if;

  if new.resolved_version_number is not null then
    select latest_version_number into latest from public.books where id = new.book_id;

    if new.resolved_version_number is distinct from latest then
      raise exception
        'a Thread may be Resolved only on the latest Version (Book % is at %, got %)',
        new.book_id, latest, new.resolved_version_number;
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_thread_resolved_once_and_on_latest
  before update on public.threads
  for each row
  when (old.resolved_version_number is distinct from new.resolved_version_number)
  execute function public.enforce_thread_resolved_once_and_on_latest();

-- A Resolved Thread is immutable (ADR-0006): no Comment lands on it afterward. Checked
-- here rather than folded into `enforce_comment_written_on_latest_version`
-- (20260814060000_comment_on_a_thread.sql) because that trigger belongs to #30's own
-- migration — this is a new rule, in the migration that introduces what it guards.
create function public.enforce_no_comment_on_resolved_thread()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.threads t
    where t.id = new.thread_id and t.resolved_version_number is not null
  ) then
    raise exception 'a Resolved Thread is immutable; no Comment may be added to it';
  end if;

  return new;
end;
$$;

create trigger enforce_no_comment_on_resolved_thread
  before insert on public.comments
  for each row
  execute function public.enforce_no_comment_on_resolved_thread();

-- The one write path. `security definer`: `threads` grants no `update` to
-- `authenticated` (see above), so this is the only way `resolved_version_number` is
-- ever set, and the only place that has to check authorship by hand — the same
-- reasoning `grant_access` already uses. The final note, if any, is inserted *before*
-- the Thread is marked Resolved — the trigger just above would otherwise refuse it,
-- since by the time `threads` is updated the note would be landing on an
-- already-Resolved Thread. The insert runs as the caller's own row (`security
-- definer` narrows only the `threads` update, not the whole function's privilege).
create function public.resolve_thread(thread uuid, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_book uuid;
  existing_resolution int;
  book_author uuid;
  latest int;
begin
  select t.book_id, t.resolved_version_number into target_book, existing_resolution
  from public.threads t where t.id = thread;

  if target_book is null then
    raise exception 'no such Thread';
  end if;

  select b.author_id, b.latest_version_number into book_author, latest
  from public.books b where b.id = target_book;

  if book_author is distinct from (select auth.uid()) then
    raise exception 'only the Author may Resolve a Thread';
  end if;

  if existing_resolution is not null then
    raise exception 'this Thread is already Resolved';
  end if;

  if note is not null and btrim(note) <> '' then
    insert into public.comments (thread_id, book_id, author_id, version_number, body)
    values (thread, target_book, (select auth.uid()), latest, note);
  end if;

  update public.threads set resolved_version_number = latest where id = thread;
end;
$$;

revoke all on function public.resolve_thread(uuid, text) from public;
grant execute on function public.resolve_thread(uuid, text) to authenticated;

-- ADR-0010's `thread_versions` column-privilege grant (for #35's Link/Unlink/Move)
-- is deliberately *not* added here: with RLS on and no `update` policy yet, the grant
-- alone does not stay inert as intended — Postgres reports an authorized-but-matchless
-- UPDATE as an ordinary zero-row success, not a permission error, which is exactly the
-- silent-no-op ADR-0010 says a rule meant to stop something must never produce (and
-- which tests/carry-open-threads.test.ts's superseded-row refusal already depends on
-- reading as a loud error). The grant belongs with #35's own migration, where its
-- policy lands in the same breath.

-- `version_threads` (#29) gains a derived `resolved` column — ADR-0006's rule read
-- back: a Thread reads Resolved on Version N exactly when it has a resolution Version
-- at or before N. The return shape changed, so the function is dropped and recreated
-- rather than `create or replace`d.
drop function public.version_threads(uuid, int);

create function public.version_threads(book uuid, version_number int)
returns table (
  thread_id uuid,
  created_by uuid,
  created_at timestamptz,
  text_position int4range,
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
    tv.text_position,
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
    ) as comments
  from public.thread_versions tv
  join public.threads t on t.id = tv.thread_id and t.book_id = tv.book_id
  where tv.book_id = version_threads.book
    and tv.version_number = version_threads.version_number
    and tv.status = 'linked';
$$;

revoke all on function public.version_threads(uuid, int) from public;
grant execute on function public.version_threads(uuid, int) to authenticated;
