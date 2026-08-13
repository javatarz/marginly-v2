import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { assetUrl } from "@/lib/reading/asset-url";
import { rewriteAssetUrls } from "@/lib/reading/rewrite-asset-urls";

/**
 * Downloads a Version's stored `index.html` and rewrites its asset URLs onto the
 * access-checked route (ADR-0012) — the one I/O adapter both the initial page render
 * and the Version-switch route share, so the rewrite pass runs identically either way.
 * RLS on the `versions` Storage bucket is the only access check here (ADR-0010): the
 * client passed in always carries the reader's own session, never a service role.
 *
 * Returns `null` for a Version this account cannot read, or one whose object is
 * missing — the two look the same to a caller with no second opinion to add, same as
 * the Book row itself (page.tsx).
 */
export async function readVersion(
  supabase: SupabaseClient<Database>,
  bookId: string,
  versionNumber: number,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("versions")
    .download(`${bookId}/${versionNumber}/index.html`);

  if (error || !data) {
    return null;
  }

  const html = await data.text();
  return rewriteAssetUrls(html, (relativePath) => assetUrl(bookId, versionNumber, relativePath));
}
