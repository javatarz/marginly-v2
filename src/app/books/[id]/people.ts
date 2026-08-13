import type { SupabaseClient } from "@supabase/supabase-js";

import { peopleList, type Person } from "@/lib/books/people-list";
import type { Database } from "@/lib/database.types";

/**
 * The People panel's read (ADR-0011): the Author and every unrevoked Reviewer.
 * `book_reviewers.reviewer_id` references `auth.users`, not `public.users`, so
 * PostgREST has no foreign key to embed the address through — this is two queries
 * under RLS, combined by the pure `peopleList` (#28).
 */
export async function fetchPeopleList(
  supabase: SupabaseClient<Database>,
  book: { id: string; authorId: string },
): Promise<Person[]> {
  const [{ data: authorRow }, { data: reviewerRows }] = await Promise.all([
    supabase.from("users").select("email").eq("id", book.authorId).maybeSingle(),
    supabase
      .from("book_reviewers")
      .select("reviewer_id")
      .eq("book_id", book.id)
      .is("revoked_at", null),
  ]);

  const reviewerIds = (reviewerRows ?? []).map((row) => row.reviewer_id);

  const { data: reviewerUserRows } = reviewerIds.length
    ? await supabase.from("users").select("id, email").in("id", reviewerIds)
    : { data: [] };

  return peopleList({
    authorId: book.authorId,
    authorEmail: authorRow?.email ?? "",
    reviewers: (reviewerUserRows ?? []).map((row) => ({ id: row.id, email: row.email })),
  });
}
