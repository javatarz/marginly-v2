-- public.users — the readable shadow of a sign-in account (ADR-0010).
--
-- auth.users is not readable by a client, so this table carries the account id and
-- the email address, kept in step by a trigger on insert. It adds no word to
-- CONTEXT.md: Author and Reviewer stay the only two kinds of person, and neither is
-- a column here. Email is the only identity shown; a display name is deliberately
-- absent until someone asks for it.

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null
);

-- ADR-0010: RLS on, and anon holds no privilege on anything.
alter table public.users enable row level security;

revoke all on public.users from anon, authenticated;
grant select on public.users to authenticated;

-- An account may always read its own row. ADR-0010's full rule is "readable only
-- where the reader and the subject share a Book", which a revoked grant row still
-- counts as — that clause needs books and book_reviewers, so it arrives with them
-- (#21). Until then the narrow rule is the safe one: it can only widen.
create policy "an account reads its own row"
  on public.users
  for select
  to authenticated
  using (id = (select auth.uid()));

-- Nothing may write through the API. Rows appear only via the trigger below, which
-- runs as definer, and the seed script is the only account creator (ADR-0001).

-- The insert trigger. security definer because it writes a table the caller holds no
-- privilege on, and `set search_path = ''` so a caller-controlled search path cannot
-- redirect the tables it reads (ADR-0010).
create function public.sync_user_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger sync_user_from_auth
  after insert on auth.users
  for each row
  execute function public.sync_user_from_auth();

-- Accounts that already exist. The trigger only fires on insert, so an account created
-- before this migration — on the linked project, or while exploring issue #6 — would
-- sign in successfully and then have no readable address anywhere in the product, with
-- nothing to fix it: re-running the seed script reports the address as existing and
-- leaves it alone.
insert into public.users (id, email)
select id, email from auth.users
where email is not null
on conflict (id) do nothing;
