"use server";

import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { validateBookName } from "@/lib/books/book-name";
import { bookPathWithRenameProblem } from "@/lib/books/rename-book-problem";
import { createClient } from "@/lib/supabase/server";

const UNIQUE_VIOLATION = "23505";

/**
 * ADR-0008 and ADR-0011: rename is refused exactly the way create is — blank, or a
 * collision with another of this Author's own Books — enforced by the same unique index,
 * so this asks Postgres the same question create-book-action.ts does and only the
 * redirect targets differ.
 *
 * `bookId` arrives bound ahead of the form (`renameBook.bind(null, book.id)`), because a
 * Server Action posted from a form only ever receives the `FormData` itself.
 */
export async function renameBook(bookId: string, form: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const validated = validateBookName(String(form.get("name") ?? ""));

  if (!validated.ok) {
    redirect(bookPathWithRenameProblem(bookId, "empty"));
  }

  const { error } = await supabase
    .from("books")
    .update({ name: validated.name })
    .eq("id", bookId);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      redirect(bookPathWithRenameProblem(bookId, "duplicate"));
    }
    throw error;
  }

  redirect(`/books/${bookId}`);
}
