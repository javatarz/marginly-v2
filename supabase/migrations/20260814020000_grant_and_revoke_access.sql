-- Granting and revoking access to a Book (#28), over ADR-0010 and ADR-0011.
--
-- No insert policy exists on book_reviewers (20260813160000_books.sql) — writing a new
-- grant row is `grant_access`'s job alone. `security definer` because the account lookup
-- has to happen over `public.users` before the Author and the Reviewer share a Book, which
-- the Author's own privileges could never see (ADR-0010); `set search_path = ''` because a
-- definer function is a hole in its own boundary.
--
-- Revoking needs none of that: the row already exists and the Author already holds a read
-- on it (the grants policy below public.books), so it is an ordinary column-scoped update —
-- the same shape ADR-0010 already uses for renaming a Book and for bumping its Version
-- counter. `revoked_at` is the only column grantable, and no delete grant exists at all, so
-- the row can never leave the table through the API (ADR-0011).

create function public.grant_access(book uuid, email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(email));
  reviewer uuid;
begin
  if not exists (
    select 1 from public.books b
    where b.id = book and b.author_id = (select auth.uid())
  ) then
    raise exception 'You do not own this Book' using errcode = 'MG000';
  end if;

  if not exists (
    select 1 from public.books b
    where b.id = book and b.latest_version_number > 0
  ) then
    raise exception 'This Book holds no Versions yet' using errcode = 'MG002';
  end if;

  -- `lower(u.email)`, not a bare column compare: the lookup normalises the typed
  -- address, but nothing normalises what a row stores it as (the backfill in
  -- 20260813140000_users.sql copies auth.users.email verbatim), so a stored mixed-case
  -- address would otherwise never match. `limit 1` because email carries no unique
  -- constraint of its own; two rows sharing one would otherwise raise a raw "more than
  -- one row" error instead of an ordinary refusal.
  select u.id into reviewer
  from public.users u
  where lower(u.email) = normalized_email
  limit 1;

  if reviewer is null then
    raise exception 'No account holds that address' using errcode = 'MG001';
  end if;

  -- The Author already has full access to their own Book; granting themselves would
  -- only add a second, redundant row keyed on the same account id — one the People
  -- panel has no sensible way to show two roles for.
  if reviewer = (select auth.uid()) then
    raise exception 'You already have access as the Author' using errcode = 'MG004';
  end if;

  -- The only refusal that turns on a *live* grant already existing (ADR-0011): a marked
  -- row falls through to the upsert below, which clears the mark rather than refusing.
  if exists (
    select 1 from public.book_reviewers r
    where r.book_id = book and r.reviewer_id = reviewer and r.revoked_at is null
  ) then
    raise exception 'This address already has access' using errcode = 'MG003';
  end if;

  insert into public.book_reviewers (book_id, reviewer_id)
  values (book, reviewer)
  on conflict (book_id, reviewer_id) do update set revoked_at = null;
end;
$$;

-- ADR-0010: `anon` holds no privilege on anything, and functions are executable by PUBLIC
-- unless told otherwise.
revoke all on function public.grant_access(uuid, text) from public;
grant execute on function public.grant_access(uuid, text) to authenticated;

grant update (revoked_at) on public.book_reviewers to authenticated;

create policy "an Author revokes their own Book's grants"
  on public.book_reviewers
  for update
  to authenticated
  using (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.author_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.author_id = (select auth.uid())
    )
  );
