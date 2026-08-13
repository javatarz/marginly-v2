import { notFound, redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { renameBookProblemMessage } from "@/lib/books/rename-book-problem";
import { createClient } from "@/lib/supabase/server";

import { deleteBook } from "./delete-book-action";
import styles from "./page.module.css";
import { UploadForm } from "./upload-form";
import { RenameDialog } from "./rename-dialog";

// Per-request and per-account, the same as the dashboard: the row that comes back
// depends on `can_read_book` (ADR-0010), which reads the session's cookies.
export const dynamic = "force-dynamic";

/**
 * The Book page (ADR-0011) — one address per Book, and the only place a Book is read.
 *
 * #22 lands only the create act and the page it opens onto, so every Book reaching
 * this route today holds zero Versions: the header bar carries the Book's name and
 * nothing else yet. ADR-0011's Version switcher has nothing to switch before a
 * Version exists, and Upload, rename, People and delete are #25, #23 and #28's acts —
 * building stub controls for them here would ship buttons that do nothing. Each of
 * those tickets amends this header when it lands its own act, the same way #36
 * expects a later ticket to amend a guard rather than work around it.
 *
 * A Reviewer can never reach this page while it holds no Versions: ADR-0008 refuses a
 * grant before a Book's first Version exists, so `can_read_book` admits only the
 * Author for as long as this route has anything to render.
 *
 * #23 lands rename and delete: both are the Author's own acts, so neither renders for a
 * Reviewer, and delete renders only while the Book holds no Versions (ADR-0011). The
 * policies in `20260813200000_rename_and_delete_a_book.sql` are the real boundary; this
 * check only decides whether the button is worth showing.
 *
 * #25 lands the Upload act itself, straight through with no preview or confirm (#26
 * inserts that step later) and no reading view yet (a later ticket renders a Version's
 * HTML) — so a Book with Versions shows only how many it holds, beside the same
 * control that landed the first one.
 */
export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ renameError?: string }>;
}) {
  const { id } = await params;
  const { renameError } = await searchParams;
  const renameMessage = renameBookProblemMessage(renameError);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const { data: book } = await supabase
    .from("books")
    .select("id, name, author_id, latest_version_number")
    .eq("id", id)
    .maybeSingle();

  // A Book that does not exist and a Book this account may not read look identical
  // here (ADR-0010's boundary fails closed): `can_read_book` is what decided whether
  // the row came back, and this page has no second opinion to add.
  if (!book) {
    notFound();
  }

  const isAuthor = book.author_id === user.id;

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.name}>{book.name}</h1>

        {isAuthor ? (
          <div className={styles.actions}>
            <RenameDialog bookId={book.id} currentName={book.name} problemMessage={renameMessage} />

            {book.latest_version_number === 0 ? (
              <form action={deleteBook.bind(null, book.id)}>
                <button type="submit" className={styles.delete}>
                  Delete
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </header>

      <main className={styles.content}>
        <p className={styles.prompt}>
          {book.latest_version_number === 0
            ? "This Book holds no Versions yet. Upload the first one to begin."
            : versionsHeldMessage(book.latest_version_number)}
        </p>

        <UploadForm bookId={book.id} />
      </main>
    </>
  );
}

function versionsHeldMessage(count: number): string {
  return count === 1
    ? "This Book holds 1 Version."
    : `This Book holds ${count} Versions.`;
}
