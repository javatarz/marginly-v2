import type { NextRequest } from "next/server";

import { refreshSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  // Everything except Next's own assets and image files. The session refresh has to
  // run on the pages a person actually browses (issue #6), and nowhere else.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
