import { type NextRequest, NextResponse } from "next/server";

import { readConfirmRequest } from "@/lib/auth/confirm-request";
import { SIGNED_IN_HOME } from "@/lib/auth/route-access";
import { signInPathWithProblem } from "@/lib/auth/sign-in-problem";
import { createClient } from "@/lib/supabase/server";

/**
 * Where a magic link lands. Verification is server-side (issue #6): the link carries a
 * token hash rather than a PKCE code, so no verifier has to be held in the browser that
 * asked for it.
 *
 * Every failure — expired, reused, malformed — gets the same message. Telling them
 * apart tells a person nothing they can act on and leaks account state, so the code is
 * logged and the person is asked to sign in again.
 */
export async function GET(request: NextRequest) {
  const confirm = readConfirmRequest(request.nextUrl.searchParams);

  if (!confirm.ok) {
    return NextResponse.redirect(at(request, signInPathWithProblem("link")));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: confirm.type,
    token_hash: confirm.tokenHash,
  });

  if (error) {
    console.error("sign-in link rejected", { code: error.code });
    return NextResponse.redirect(at(request, signInPathWithProblem("link")));
  }

  return NextResponse.redirect(at(request, SIGNED_IN_HOME));
}

function at(request: NextRequest, path: string): URL {
  const [pathname, search] = path.split("?");
  const url = request.nextUrl.clone();
  const host = request.headers.get("host");
  if (host) {
    url.host = host;
  }
  url.pathname = pathname ?? SIGNED_IN_HOME;
  url.search = search ? `?${search}` : "";
  return url;
}
