-- Books, the grants over them, and the one access check every later table calls.
--
-- ADR-0010 puts the boundary in Postgres rather than in the app, because Supabase
-- publishes every table over HTTP and the web app will not be the only client. So:
-- RLS on, `anon` privileged on nothing, and one function answering the only access
-- question the product has.
--
-- Every migration adding a table under a Book has three obligations (ADR-0010): a
-- `book_id`, RLS enabled, policies written. A table that skips them is wide open and
-- looks finished, because fails-closed here is the *absence* of a policy.

-- The Book itself. `latest_version_number` is the Book's own counter, bumped inside the
-- Upload's transaction (ADR-0009) — it is how many Versions the Book holds, and 0 while
-- it holds none. The `versions` table it will point into arrives with the Upload (#25).
create table public.books (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  latest_version_number int not null default 0 check (latest_version_number >= 0),
  created_at timestamptz not null default now()
);

-- Both lookups that ask a Book who wrote it: `can_read_book`'s author clause, and the
-- address policy at the foot of this file. Deliberately not an index for the dashboard's
-- ordering — that query has no `where` and no `order by`, because the policies choose the
-- rows and ADR-0011's ordering is decided in the app.
create index books_author_id_idx on public.books (author_id);

-- A grant is a row, keyed on the Reviewer's **account id** rather than their email
-- address (ADR-0010): a Reviewer who changes their address would otherwise silently lose
-- every Book, and an address later reassigned would silently gain them.
--
-- Revoking **marks** the row and never deletes it (ADR-0011), which is what keeps a
-- revoked Reviewer's address readable beside the Comments they wrote. The two readers of
-- this table want different things and both are named: the access check wants a live
-- row, the identity read wants any row. Writing rows here is the Author's grant call
-- (#28); no policy grants it, so nothing can insert one through the API.
create table public.book_reviewers (
  book_id uuid not null references public.books (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (book_id, reviewer_id)
);

create index book_reviewers_reviewer_id_idx
  on public.book_reviewers (reviewer_id, book_id);

-- The one access check. ADR-0010: `security definer` is not an optimisation here — the
-- policy on `books` reads `book_reviewers` and the policy on `book_reviewers` reads
-- `books`, and evaluating either inside the other's policy is a cycle Postgres refuses.
-- A definer function sees rows without policy checks, which breaks the cycle and lets the
-- planner treat the result as a constant rather than re-deriving it per row.
--
-- `set search_path = ''` because a definer function is a hole in its own boundary: without
-- it a caller-controlled search path redirects the tables it reads.
create function public.can_read_book(book uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.books b
    where b.id = book
      and (b.author_id = (select auth.uid())
        or exists (
          select 1 from public.book_reviewers r
          where r.book_id = b.id
            and r.reviewer_id = (select auth.uid())
            and r.revoked_at is null))
  );
$$;

-- ADR-0010: `anon` holds no privilege on anything. Functions are executable by PUBLIC
-- unless told otherwise, and this one reads past every policy.
revoke all on function public.can_read_book(uuid) from public;
grant execute on function public.can_read_book(uuid) to authenticated;

alter table public.books enable row level security;
alter table public.book_reviewers enable row level security;

revoke all on public.books from anon, authenticated;
revoke all on public.book_reviewers from anon, authenticated;

grant select on public.books to authenticated;
grant select on public.book_reviewers to authenticated;

-- One call to the check, on both tables. Creating, renaming and deleting a Book are
-- separate acts with their own policies (#22, #23); reading is all this ticket grants.
create policy "a Book is read by whoever may read it"
  on public.books
  for select
  to authenticated
  using (public.can_read_book(id));

-- A Book's Reviewer list is readable by everyone on that Book (ADR-0010): seeing who else
-- is reviewing is the same disclosure as seeing who wrote each Comment. Revoked rows are
-- included, because the People panel filters to live grants (#28) while the address read
-- below needs the marked ones.
create policy "a Book's grants are read by whoever may read the Book"
  on public.book_reviewers
  for select
  to authenticated
  using (public.can_read_book(book_id));

-- Identity, now that a Book exists to share.
--
-- 20260813140000_users.sql could only give an account its own row: ADR-0010's rule is
-- that an address is readable where the reader and the subject share a Book, and there
-- were no Books. This is the rest of that rule.
--
-- **The two sides of "share a Book" are not the same question**, and reading ADR-0011's
-- promise as symmetric is a leak.
--
-- What that ADR promises is one-directional: a revoked Reviewer's address stays readable
-- *to everyone still on the Book*, because words other people replied to need their
-- author. So the **subject** may be merely present on the Book, marked or not.
--
-- The **reader** may not. A revoked Reviewer who kept this would go on learning who else
-- is on a Book they can no longer read, including people granted after they left — and
-- ADR-0010 puts identity behind a Book precisely because "the fact that a particular
-- person is on it at all is itself a disclosure". Revoking removes reading, and who else
-- is here is something read.
--
-- **No fourth `security definer` function.** ADR-0010 names three holes in the boundary —
-- the access check, the grant, and Resolve — and this is not a fourth. Both sides fall
-- out of the policies already written above: read inside this policy, `books` yields only
-- the Books this reader may read (`can_read_book`, so live access only) and
-- `book_reviewers` yields every grant row on those Books (marked ones included). The
-- reader's half is therefore `can_read_book` itself rather than a second copy of it that
-- could drift from it, and the subject's half is the row's bare existence.
--
-- There is no cycle to break here, which is why no definer function is needed: this reads
-- `books`, whose policy calls a definer function that reads no policy at all.
create policy "an account reads an address it shares a Book with"
  on public.users
  for select
  to authenticated
  using (
    exists (select 1 from public.books b where b.author_id = users.id)
    or exists (
      select 1 from public.book_reviewers r where r.reviewer_id = users.id)
  );
