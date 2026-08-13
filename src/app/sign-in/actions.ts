"use server";

import { redirect } from "next/navigation";

import { signInPathWithProblem } from "@/lib/auth/sign-in-problem";
import { createClient } from "@/lib/supabase/server";

/**
 * Ask for a magic link.
 *
 * `shouldCreateUser: false` is what keeps ADR-0001's "no sign-up flow" true at the call
 * site as well as in the project settings: an address with no account gets nothing, and
 * no account is created. The mailer allows two messages an hour (issue #6), so a refusal
 * for rate is expected and says so.
 */
export async function requestMagicLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim();

  if (!email) {
    redirect(signInPathWithProblem("email"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  // An address with no account comes back 422 `otp_disabled`, because
  // `shouldCreateUser: false` refuses to create one. Reporting that would make this
  // page an oracle over the account list — ask for a link for any address and the
  // wording tells you whether the person has an account. ADR-0010 accepts exactly one
  // such oracle, the Author's own grant call, and this is not it.
  //
  // So only the rate limit answers differently: a person who is being throttled needs
  // to know to wait, and it says nothing about any address.
  if (error) {
    console.error("magic link not sent", { code: error.code, status: error.status });

    if (error.status === 429) {
      redirect(signInPathWithProblem("rate"));
    }
  }

  redirect("/sign-in?sent=1");
}
