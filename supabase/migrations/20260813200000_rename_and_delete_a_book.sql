-- Renaming and deleting a Book (#23) — the Author's own acts, over the boundary #22 built.
--
-- ADR-0008: a rename is refused blank and refused a collision, by the same unique index
-- creating a Book already enforces — nothing new to add there. Delete only ever removes a
-- Book holding no Versions; once one exists the Book is permanent (ADR-0008), so the
-- policy encodes that condition rather than the app.

-- Column-level, not table-level: an Author may change `name` and nothing else through the
-- API. `latest_version_number` is bumped only inside the Upload's transaction (#25), never
-- by a client request, and this is what keeps that true even though the row-level policy
-- below cannot see which columns a request touches.
grant update (name) on public.books to authenticated;
grant delete on public.books to authenticated;

create policy "an Author renames their own Book"
  on public.books
  for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- "Only such a Book" (ADR-0008): the condition lives in the policy, not the app, so no
-- route through the API can delete a Book that holds a Version.
create policy "an Author deletes their own Book while it holds no Versions"
  on public.books
  for delete
  to authenticated
  using (author_id = (select auth.uid()) and latest_version_number = 0);
