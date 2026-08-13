import { notFound, redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { createClient } from "@/lib/supabase/server";

import styles from "./page.module.css";

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
 */
export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const { data: book } = await supabase
    .from("books")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  // A Book that does not exist and a Book this account may not read look identical
  // here (ADR-0010's boundary fails closed): `can_read_book` is what decided whether
  // the row came back, and this page has no second opinion to add.
  if (!book) {
    notFound();
  }

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.name}>{book.name}</h1>
      </header>

      <main className={styles.content}>
        <p className={styles.prompt}>
          This Book holds no Versions yet. Upload the first one to begin.
        </p>
      </main>
    </>
  );
}
