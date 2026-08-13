import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { readVersion } from "../../read-version";

/**
 * What the reading view's Version switcher calls (#27, ADR-0011): the Book keeps one
 * address, so switching Versions is a client-side fetch rather than a navigation, and
 * this is what it fetches. `can_read_book` (via RLS on both `versions` and the
 * `versions` Storage bucket) is the only access check — a Version this account cannot
 * read, or one that does not exist, comes back as the same 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const { id, version } = await params;
  const versionNumber = Number(version);

  if (!Number.isInteger(versionNumber)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const supabase = await createClient();

  const { data: row } = await supabase
    .from("versions")
    .select("version_number, created_at")
    .eq("book_id", id)
    .eq("version_number", versionNumber)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const html = await readVersion(supabase, id, versionNumber);
  if (html === null) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  return NextResponse.json({
    versionNumber: row.version_number,
    createdAt: row.created_at,
    html,
  });
}
