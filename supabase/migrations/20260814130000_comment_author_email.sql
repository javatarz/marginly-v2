-- Comment author name in Threads: the margin showed only "Author"/"Reviewer" (#30),
-- never who wrote a Comment. Deriving a display name from an email needs the email
-- itself, which `version_threads`' `comments` jsonb never carried — this adds it.
--
-- Dropped and recreated, not `create or replace`d, for the same reason #34's and #35's
-- migrations give: a table-returning function's own output columns are unchanged here
-- (`comments` is still one `jsonb` column), but its shape inside that column grows an
-- `author_email` field, and Postgres has no way to `create or replace` into that.
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
          'author_email', u.email,
          'body', c.body,
          'created_at', c.created_at
        )
        order by c.created_at
      )
      from public.comments c
      join public.users u on u.id = c.author_id
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
