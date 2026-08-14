import { notFound, redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { grantAccessProblemMessage } from "@/lib/books/grant-access-problem";
import { renameBookProblemMessage } from "@/lib/books/rename-book-problem";
import { createClient } from "@/lib/supabase/server";

import { deleteBook } from "./delete-book-action";
import { fetchPeopleList } from "./people";
import { PeoplePanel } from "./people-panel";
import { readVersion } from "./read-version";
import { Reader } from "./reader";
import styles from "./page.module.css";
import { UploadForm } from "./upload-form";
import { RenameDialog } from "./rename-dialog";

// Per-request and per-account, the same as the dashboard: the row that comes back
// depends on `can_read_book` (ADR-0010), which reads the session's cookies.
export const dynamic = "force-dynamic";

/**
 * The Book page (ADR-0011) — one address per Book, and the only place a Book is read.
 *
 * A zero-Version Book still shows only its name and, for the Author, Upload and
 * delete: ADR-0008 refuses a Reviewer grant before a Book's first Version exists, so
 * `can_read_book` admits only the Author for as long as this route has nothing to
 * read, and ADR-0011's switcher has nothing to switch yet either.
 *
 * Once a Version exists, `Reader` (#27) takes over the header and the content: it
 * opens on the latest Version (ADR-0007), and Upload, rename, People and the switcher
 * all work from there regardless of which Version is on screen (ADR-0011). This page's
 * rename/delete/grant access checks are UI-only; `20260813200000_rename_and_delete_a_book.sql`
 * and `20260814020000_grant_and_revoke_access.sql`'s policies (and `grant_access`
 * itself) are the real boundary, same as `can_read_book` is for reading at all.
 */
export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ renameError?: string; peopleError?: string }>;
}) {
  const { id } = await params;
  const { renameError, peopleError } = await searchParams;
  const renameMessage = renameBookProblemMessage(renameError);
  const peopleMessage = grantAccessProblemMessage(peopleError);

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
  const people = await fetchPeopleList(supabase, { id: book.id, authorId: book.author_id });

  if (book.latest_version_number === 0) {
    return (
      <>
        <header className={styles.header}>
          <h1 className={styles.name}>{book.name}</h1>

          <div className={styles.actions}>
            <PeoplePanel
              bookId={book.id}
              isAuthor={isAuthor}
              people={people}
              problemMessage={peopleMessage}
            />

            {isAuthor ? (
              <>
                <RenameDialog bookId={book.id} currentName={book.name} problemMessage={renameMessage} />

                <form action={deleteBook.bind(null, book.id)}>
                  <button type="submit" className={styles.delete}>
                    Delete
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </header>

        <main className={styles.content}>
          <p className={styles.prompt}>This Book holds no Versions yet. Upload the first one to begin.</p>

          {isAuthor ? <UploadForm bookId={book.id} /> : null}
        </main>
      </>
    );
  }

  const { data: versions } = await supabase
    .from("versions")
    .select("version_number, created_at")
    .eq("book_id", book.id)
    .order("version_number", { ascending: false });

  // `latest_version_number` is bumped by the Upload transaction alongside its `versions`
  // insert (ADR-0009), but RLS also grants an Author `update (latest_version_number)`
  // directly (ADR-0010, for that same transaction to work under RLS) — nothing at the
  // schema level stops a stray direct write from bumping the counter with no matching
  // Version. That is the Author's own mistake to have made, on their own Book, and
  // never a Reviewer's to hit (`can_read_book` already gated the row above); reading
  // still shouldn't 500 forever over it, so this degrades to a plain message instead of
  // the ordinary reading view, with Rename left reachable to keep the Book recoverable.
  const html =
    versions && versions.length > 0
      ? await readVersion(supabase, book.id, book.latest_version_number)
      : null;

  if (html === null) {
    return (
      <>
        <header className={styles.header}>
          <h1 className={styles.name}>{book.name}</h1>

          <div className={styles.actions}>
            <PeoplePanel
              bookId={book.id}
              isAuthor={isAuthor}
              people={people}
              problemMessage={peopleMessage}
            />

            {isAuthor ? (
              <RenameDialog bookId={book.id} currentName={book.name} problemMessage={renameMessage} />
            ) : null}
          </div>
        </header>

        <main className={styles.content}>
          <p className={styles.prompt}>This Book&apos;s latest Version could not be read.</p>
        </main>
      </>
    );
  }

  return (
    <Reader
      key={book.id}
      bookId={book.id}
      bookName={book.name}
      bookAuthorId={book.author_id}
      currentUserId={user.id}
      isAuthor={isAuthor}
      versions={(versions ?? []).map((version) => ({
        versionNumber: version.version_number,
        createdAt: version.created_at,
      }))}
      latestVersionNumber={book.latest_version_number}
      initialVersionNumber={book.latest_version_number}
      initialHtml={html}
      renameMessage={renameMessage}
      people={people}
      peopleMessage={peopleMessage}
    />
  );
}
