import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { createBookProblemMessage } from "@/lib/books/create-book-problem";
import { displayNameFromEmail } from "@/lib/books/display-name";
import {
  latestUploadPerBook,
  presentDashboard,
  type BookList,
} from "@/lib/dashboard/dashboard-view";
import { createClient } from "@/lib/supabase/server";

import { createBook } from "./create-book-action";
import styles from "./page.module.css";
import { UploadDate } from "./upload-date";

// Per-request and per-account: it reads the session's cookies and the Books the policies
// let that account see. There is nothing here to prerender at build time.
export const dynamic = "force-dynamic";

/**
 * The dashboard — one route for everyone, holding two lists (ADR-0011).
 *
 * The thin adapter over one query. Which Books come back is the database's decision, made
 * by `can_read_book` (ADR-0010): this never filters by account, so a Book reaching this
 * page is a Book the reader is entitled to. How the two lists read is
 * `src/lib/dashboard/dashboard-view.ts`, where it can be tested without a request.
 *
 * Creating a Book lives here too (ADR-0011, #22): no Book page exists yet to hold the
 * act, and it is the Author's only entry into one.
 */
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ bookError?: string }>;
}) {
  const { bookError } = await searchParams;
  const createBookMessage = createBookProblemMessage(bookError);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware already turns a signed-out request away; this is the same rule at the
  // page, so the query below always has an account to ask about.
  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const { data: account } = await supabase
    .from("users")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();

  const { data: books } = await supabase
    .from("books")
    .select("id, name, author_id, latest_version_number, created_at");

  const { data: versions } = await supabase
    .from("versions")
    .select("book_id, created_at");

  const latestUploadedAt = latestUploadPerBook(
    (versions ?? []).map((version) => ({
      bookId: version.book_id,
      createdAt: version.created_at,
    })),
  );

  const view = presentDashboard({
    accountId: user.id,
    books: (books ?? []).map((book) => ({
      id: book.id,
      name: book.name,
      authorId: book.author_id,
      versionCount: book.latest_version_number,
      latestUploadedAt: latestUploadedAt.get(book.id) ?? null,
      createdAt: book.created_at,
    })),
  });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Marginly</h1>
        <p className={styles.signedInAs}>
          Signed in as{" "}
          {account?.email ? displayNameFromEmail(account.email) : "an account with no readable address"}.
        </p>
      </header>

      <Books heading="Books I own" list={view.owned}>
        <CreateBookForm message={createBookMessage} />
      </Books>

      <Books heading="Books shared with me" list={view.shared} />
    </main>
  );
}

/** Create asks for a name and nothing else (ADR-0008), and nothing more than that. */
function CreateBookForm({ message }: { message?: string }) {
  return (
    <form action={createBook} className={styles.createForm}>
      <div className={styles.createFormRow}>
        <label htmlFor="book-name" className={styles.label}>
          Name the Book
        </label>
        <input id="book-name" name="name" type="text" required className={styles.input} />
        <button type="submit" className={styles.button}>
          Create
        </button>
      </div>

      {message ? (
        <p role="alert" className={styles.alert}>
          {message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * A row is the Book's name, how many Versions it holds, and when the latest one was
 * Uploaded (ADR-0011) — and no Thread activity of any kind: no unread count, no count of
 * Open Threads, no timestamp of the newest Comment.
 */
function Books({
  heading,
  list,
  children,
}: {
  heading: string;
  list: BookList;
  children?: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2>{heading}</h2>
      {children}
      <BookRows list={list} />
    </section>
  );
}

function BookRows({ list }: { list: BookList }) {
  if (list.emptyMessage) {
    return <p className={styles.empty}>{list.emptyMessage}</p>;
  }

  return (
    <ul className={styles.list}>
      {list.rows.map((row) => (
        <li key={row.id}>
          <Link href={`/books/${row.id}`} className={styles.row}>
            <span className={styles.name}>{row.name}</span>
            <span className={styles.meta}>
              <span>{row.versionsHeld}</span>
              {row.latestUpload ? (
                <span>
                  Uploaded <UploadDate value={row.latestUpload} />
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
