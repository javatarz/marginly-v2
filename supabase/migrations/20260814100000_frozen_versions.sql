-- Frozen Versions (#34) — ADR-0002/0003/0006/0010.
--
-- `version_threads` (20260814040000_start_a_thread.sql, extended by #31's
-- 20260814090000_resolve_a_thread.sql to add `resolved`) still only ever selected a
-- Thread's `status = 'linked'` row and returned every Comment it ever held, with no
-- regard for which Version was asked for. Both were fine the day they were written —
-- neither #29 nor #31 had landed a Thread anywhere but Linked yet, nor a Comment
-- history to cut off — but #33's carry produces exactly the state both gaps miss: an
-- Unlinked Thread is still Open and still part of the record (ADR-0002/0003), and
-- reading Version N must never show a Comment some later Version wrote (ADR-0006).
--
-- The function is dropped and recreated rather than `create or replace`d because its
-- result columns change shape (`status` and `thread_position` are new); Postgres refuses
-- `create or replace function` across a change to a table-returning function's own
-- output columns.
drop function public.version_threads(uuid, int);

-- The one shared read for a Version's discussion (ADR-0006's "one row per Version"
-- model, read back out): every page that opens a Version calls this rather than
-- querying `thread_versions` and `comments` directly, so the freeze rule is enforced
-- once, here, rather than by every caller remembering both halves of it independently.
--
-- `security invoker`, `stable`, unchanged from the original: every row this touches is
-- already gated by `thread_versions`' and `comments`' own select policies, so reading it
-- as the caller is both correct and simpler than a definer function re-checking
-- `can_read_book` by hand.
--
-- The Comment cut-off (`c.version_number <= version_threads.version_number`) is
-- deliberately here and nowhere else. A policy cannot know which Version a reader has on
-- screen — that is a fact about which page they are looking at, not about who they are
-- — so threading it through a client-set session variable would turn a display bug (the
-- wrong Version's Comments shown) into a privilege bug (a policy silently trusting a
-- client-supplied claim). Keeping it a plain `where` clause in a `security invoker`
-- function means a caller gets exactly the rows their own policies already allow,
-- narrowed to the Version they asked for.
--
-- `resolved` (#31) is untouched: a Thread reads Resolved on Version N exactly when it
-- has a resolution Version at or before N, which is already correct regardless of
-- Linked or Unlinked — resolving a Thread says nothing about where its Highlight sits.
create function public.version_threads(book uuid, version_number int)
returns table (
  thread_id uuid,
  created_by uuid,
  created_at timestamptz,
  status text,
  text_position int4range,
  thread_position int4,
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
