import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "@/lib/env";

/**
 * The client for Client Components — the Upload control needs one to put the zip
 * straight into Storage and to invoke the `upload` Edge Function under the Author's
 * own session, rather than routing bytes through a Server Action (ADR-0009: the browser
 * sends the zip to Storage itself; the Edge Function receives a path, not a body).
 * Holds the anon key, never a service key (ADR-0010).
 */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
