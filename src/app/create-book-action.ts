"use server";

import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { validateBookName } from "@/lib/books/book-name";
import { dashboardPathWithProblem } from "@/lib/books/create-book-problem";
import { createClient } from "@/lib/supabase/server";

const UNIQUE_VIOLATION = "23505";

/**
 * ADR-0008: creating a Book is the Author's own distinct act — a name and nothing
 * else, landing on the new Book's page with zero Versions.
 *
 * The id is generated here rather than read back from the insert. PostgREST's
 * `RETURNING` (what `.select()` on an insert asks for) re-checks the new row against
 * the table's *select* policy in the same command as the not-yet-externally-visible
 * insert, and `can_read_book` — a `stable security definer` function — does not
 * reliably see its own row there: it reports the same "violates row-level security
 * policy" error a real refusal would, for a row the policy plainly admits a moment
 * later. Generating the id here and never asking for it back avoids that entirely.
 */
export async function createBook(form: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Checked before the name, so a session that lapsed between page load and submit
  // goes straight to sign-in rather than back to the dashboard with a problem code
  // whose message the sign-in redirect that follows would only throw away.
  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const validated = validateBookName(String(form.get("name") ?? ""));

  if (!validated.ok) {
    redirect(dashboardPathWithProblem("empty"));
  }

  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("books")
    .insert({ id, author_id: user.id, name: validated.name });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      redirect(dashboardPathWithProblem("duplicate"));
    }
    throw error;
  }

  redirect(`/books/${id}`);
}
