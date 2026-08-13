import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { presentDashboard, type BookList } from "@/lib/dashboard/dashboard-view";
import { createClient } from "@/lib/supabase/server";

import styles from "./page.module.css";

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
 */
export default async function Dashboard() {
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

  const view = presentDashboard({
    accountId: user.id,
    books: (books ?? []).map((book) => ({
      id: book.id,
      name: book.name,
      authorId: book.author_id,
      versionCount: book.latest_version_number,
      // When the latest Version was Uploaded arrives with the `versions` table (#25).
      // Every Book holds none today, so every row reads as holding none and sorts by
      // when it was created — which is what ADR-0011 asks for in that case anyway.
      latestUploadedAt: null,
      createdAt: book.created_at,
    })),
  });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Marginly</h1>
        <p className={styles.signedInAs}>
          Signed in as {account?.email ?? "an account with no readable address"}.
        </p>
      </header>

      <Books heading="Books I own" list={view.owned} />
      <Books heading="Books shared with me" list={view.shared} />
    </main>
  );
}

/**
 * A row is the Book's name, how many Versions it holds, and when the latest one was
 * Uploaded (ADR-0011) — and no Thread activity of any kind: no unread count, no count of
 * Open Threads, no timestamp of the newest Comment.
 */
function Books({ heading, list }: { heading: string; list: BookList }) {
  return (
    <section className={styles.section}>
      <h2>{heading}</h2>

      {list.emptyMessage ? (
        <p className={styles.empty}>{list.emptyMessage}</p>
      ) : (
        <ul className={styles.list}>
          {list.rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <span className={styles.name}>{row.name}</span>
              <span className={styles.meta}>
                <span>{row.versionsHeld}</span>
                {row.latestUpload ? <span>Uploaded {row.latestUpload}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
