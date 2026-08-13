"use server";

import { redirect } from "next/navigation";

import { SIGNED_IN_HOME, SIGN_IN_PATH } from "@/lib/auth/route-access";
import { createClient } from "@/lib/supabase/server";

/**
 * ADR-0008: delete exists only to undo the create step, and only such a Book can be
 * deleted. The condition — the Author's own Book, holding no Versions — is the delete
 * policy enforces (#23's migration); this never re-checks it, the same way the header
 * bar's own visibility rule never stands in for that policy.
 */
export async function deleteBook(bookId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const { error } = await supabase.from("books").delete().eq("id", bookId);

  if (error) {
    throw error;
  }

  redirect(SIGNED_IN_HOME);
}
