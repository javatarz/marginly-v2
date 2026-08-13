import { NextResponse } from "next/server";

import { contentTypeFor } from "@/lib/reading/asset-content-type";
import { createClient } from "@/lib/supabase/server";

/**
 * The access-checked asset route ADR-0012 rewrites every Version's `src` and `srcset`
 * onto at read time. RLS on the `versions` Storage bucket (`can_read_book`, ADR-0010)
 * is the only access check — this route holds no second opinion, same as every other
 * read in the Book page. A Version is immutable, so its assets are cached hard.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string; path: string[] }> },
) {
  const { id, version, path } = await params;
  const versionNumber = Number(version);

  if (!Number.isInteger(versionNumber) || path.length === 0) {
    return new NextResponse(null, { status: 404 });
  }

  const supabase = await createClient();
  const objectPath = `${id}/${versionNumber}/${path.join("/")}`;

  const { data, error } = await supabase.storage.from("versions").download(objectPath);
  if (error || !data) {
    return new NextResponse(null, { status: 404 });
  }

  const fileName = path[path.length - 1] ?? "";

  return new NextResponse(data, {
    headers: {
      "content-type": contentTypeFor(fileName),
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
