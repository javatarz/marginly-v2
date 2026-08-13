-- Creating a Book (#22) — the Author's own act, laid over the read-only boundary #21 built.
--
-- ADR-0008: the name is free text, refused blank, and unique among the Author's own Books,
-- compared trimmed and case-insensitively. Both rules are enforced here rather than by the
-- app alone (ADR-0010 puts the boundary in Postgres); the app's own check exists only to
-- answer with a friendlier message before ever reaching the database.

alter table public.books
  add constraint books_name_not_blank check (btrim(name) <> '');

-- Per Author, not global (ADR-0008): a global rule would disclose a Book under an Author
-- the reader cannot read, and comparing sensitively would let two rows sit in the
-- dashboard reading identically.
create unique index books_author_name_unique
  on public.books (author_id, lower(btrim(name)));

-- ADR-0010: `revoke all ... from anon, authenticated` in the previous migration took away
-- every privilege, select included, and the read policy alone put select back. A write
-- needs the same two layers: the privilege here, and the policy below deciding which rows.
grant insert on public.books to authenticated;

-- The one write tests/books-policies.test.ts already waits for: an Author inserts a Book
-- under their own id, and under no other — an insert under any other id still finds no
-- policy that admits it.
create policy "an Author creates a Book under their own id"
  on public.books
  for insert
  to authenticated
  with check (author_id = (select auth.uid()));
