import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth/route-access";
import { createClient } from "@/lib/supabase/server";

// Per-request and per-account: it reads the session's cookies and one row written for
// that account. There is nothing here to prerender at build time.
export const dynamic = "force-dynamic";

/**
 * Where a signed-in person lands. ADR-0011 makes this the dashboard, which arrives with
 * the Books it lists (#21); for now it says who is signed in.
 *
 * The address comes from `public.users` rather than from the session, so this page reads
 * the row the insert trigger wrote, through the policy that guards it (ADR-0010).
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware already turns a signed-out request away; this is the same rule at
  // the page, so the query below always has an account to ask about.
  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  const { data: account } = await supabase
    .from("users")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main>
      <h1>Marginly</h1>
      <p>Signed in as {account?.email ?? "an account with no readable address"}.</p>
      <p>Your Books will be listed here.</p>
    </main>
  );
}
