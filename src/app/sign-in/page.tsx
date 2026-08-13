import { signInProblemMessage } from "@/lib/auth/sign-in-problem";

import { requestMagicLink } from "./actions";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const message = signInProblemMessage(error);

  return (
    <main>
      <h1>Sign in to Marginly</h1>

      {sent ? (
        <p>
          If that address has an account, a sign-in link is on its way. The link is
          valid for one hour.
        </p>
      ) : null}

      {message ? <p role="alert">{message}</p> : null}

      <form action={requestMagicLink}>
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <button type="submit">Send me a sign-in link</button>
      </form>

      <p>
        Accounts are created by an operator. There is no sign-up — if you have no
        account, ask the Author who is sharing the Book with you.
      </p>
    </main>
  );
}
