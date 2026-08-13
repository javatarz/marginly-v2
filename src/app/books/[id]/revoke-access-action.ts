"use server";

import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { createClient } from "@/lib/supabase/server";

/**
 * ADR-0010/ADR-0011: revoking sets `revoked_at` and never deletes the row — an
 * ordinary column-scoped update, not a function, because the row already exists and
 * the Author already holds a read on it. The update policy
 * (20260814020000_grant_and_revoke_access.sql) is the real boundary; a Reviewer or
 * another Author posting this action matches no row and the update is a silent no-op,
 * the same shape a blocked rename takes.
 */
export async function revokeAccess(bookId: string, reviewerId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const { error } = await supabase
    .from("book_reviewers")
    .update({ revoked_at: new Date().toISOString() })
    .eq("book_id", bookId)
    .eq("reviewer_id", reviewerId);

  if (error) {
    throw error;
  }

  redirect(`/books/${bookId}`);
}
