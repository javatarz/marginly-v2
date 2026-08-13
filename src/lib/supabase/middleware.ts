import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { decideRouteAccess } from "@/lib/auth/route-access";
import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "@/lib/env";

/**
 * The refresh, on every request.
 *
 * This is load-bearing rather than boilerplate: the built-in mailer is capped at two
 * messages an hour (issue #6), so every session this terminates early is spent as a
 * magic-link email out of a very small budget. `getUser` is what performs the
 * refresh, and the cookies it writes must ride out on the response that is returned —
 * including on a redirect, or the refresh is thrown away.
 */
export async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = decideRouteAccess({
    path: request.nextUrl.pathname,
    signedIn: user !== null,
  });

  if (access.allow) {
    return response;
  }

  const destination = request.nextUrl.clone();
  destination.pathname = access.redirectTo;
  destination.search = "";

  const redirect = NextResponse.redirect(destination);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}
