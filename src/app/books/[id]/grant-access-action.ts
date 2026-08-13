"use server";

import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import {
  bookPathWithGrantProblem,
  grantAccessProblemFromErrorCode,
} from "@/lib/books/grant-access-problem";
import { createClient } from "@/lib/supabase/server";

/**
 * ADR-0010/ADR-0011: granting is a single RPC to `grant_access`, which does the
 * lookup, the ownership check and the three named refusals itself — this only reads
 * back which one fired (by the custom error code the function raises) and turns it
 * into the People panel's own query-string problem, the same shape rename uses.
 *
 * `bookId` arrives bound ahead of the form (`grantAccess.bind(null, book.id)`), the
 * same as `renameBook`.
 */
export async function grantAccess(bookId: string, form: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const email = String(form.get("email") ?? "");

  const { error } = await supabase.rpc("grant_access", { book: bookId, email });

  if (error) {
    const problem = grantAccessProblemFromErrorCode(error.code);
    if (problem) {
      redirect(bookPathWithGrantProblem(bookId, problem));
    }
    throw error;
  }

  redirect(`/books/${bookId}`);
}
