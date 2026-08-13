import { signInProblemMessage } from "@/lib/auth/sign-in-problem";

import { requestMagicLink } from "./actions";
import styles from "./page.module.css";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const message = signInProblemMessage(error);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Sign in to Marginly</h1>

        {sent ? (
          <p className={styles.notice}>
            If that address has an account, a sign-in link is on its way. The link
            is valid for one hour.
          </p>
        ) : null}

        {message ? (
          <p role="alert" className={styles.alert}>
            {message}
          </p>
        ) : null}

        <form action={requestMagicLink} className={styles.form}>
          <label htmlFor="email" className={styles.label}>
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={styles.input}
          />
          <button type="submit" className={styles.button}>
            Send me a sign-in link
          </button>
        </form>

        <p className={styles.footnote}>
          Accounts are created by an operator. There is no sign-up — if you have no
          account, ask the Author who is sharing the Book with you.
        </p>
      </div>
    </main>
  );
}
