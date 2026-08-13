import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "@/lib/env";

/**
 * The client for Server Components, Server Actions and route handlers. Reads the
 * session from the request's cookies; holds the anon key, never a service key
 * (ADR-0010).
 */
export async function createClient() {
  const { url, anonKey } = supabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component cannot set cookies. The middleware refreshes the
          // session on every request, so there is nothing to recover here.
        }
      },
    },
  });
}
