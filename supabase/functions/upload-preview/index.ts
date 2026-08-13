import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { jsonResponse } from "../_shared/http.ts";
import { decodeBearerClaims } from "../_shared/jwt.ts";
import { previewUpload } from "../_shared/preview.ts";
import { unzip } from "../_shared/preview/unzip.ts";
import {
  isBookId,
  isDuplicateOfLatest,
  type PendingManifest,
  pendingManifestPath,
  pendingObjectPath,
  planPendingManifest,
  planVersionObjects,
  stagingZipPath,
} from "../_shared/upload_plan.ts";

/**
 * The preview half of an Upload (#26, ADR-0008/ADR-0009/ADR-0015): one synchronous
 * call over a zip the browser has already staged. Unzips, hashes, sanitises, extracts
 * and segments it, refuses outright if the hash matches the latest Version, then
 * stages the sanitised bundle a later, separate `upload-confirm` call copies into a
 * Version. Nothing in `versions` or `books` is written here — a Version becomes
 * readable only once the confirm's transaction commits.
 *
 * A thin I/O adapter (CODING_STANDARDS.md §2): the decisions it wires together — the
 * preview seam, and what to stage — are pure and tested on their own.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "POST only." }, 405);
  }

  const authorization = req.headers.get("authorization");
  const claims = decodeBearerClaims(authorization);
  if (!claims) {
    return jsonResponse({ ok: false, message: "Sign in to Upload." }, 401);
  }

  let bookId: unknown;
  try {
    ({ bookId } = await req.json());
  } catch {
    return jsonResponse({ ok: false, message: "A bookId is required." }, 400);
  }

  if (typeof bookId !== "string" || !isBookId(bookId)) {
    return jsonResponse({ ok: false, message: "A bookId is required." }, 400);
  }

  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authorization! } } },
  );
  const storage = supabase.storage;

  const { data: book } = await supabase
    .from("books")
    .select("name, latest_version_number")
    .eq("id", bookId)
    .maybeSingle();

  if (!book) {
    return jsonResponse({ ok: false, message: "No Book was found to Upload to." }, 404);
  }

  const { data: zipFile, error: downloadError } = await storage
    .from("staging")
    .download(stagingZipPath(bookId));

  if (downloadError || !zipFile) {
    return jsonResponse(
      { ok: false, message: "No staged Upload was found for this Book." },
      404,
    );
  }

  const zipBytes = new Uint8Array(await zipFile.arrayBuffer());

  const preview = await previewUpload(zipBytes);
  if (!preview.ok) {
    return jsonResponse(preview, 422);
  }

  const latestHash = await latestVersionHash(supabase, bookId, book.latest_version_number);
  if (isDuplicateOfLatest(preview.hash, latestHash)) {
    return jsonResponse(
      {
        ok: false,
        message: "This Upload is identical to the latest Version already on this Book.",
      },
      422,
    );
  }

  const files = await unzip(zipBytes);
  const objects = planVersionObjects(files, preview);
  const manifest = planPendingManifest(objects, preview.hash);

  await clearPending(storage, bookId);

  for (const object of objects) {
    const { error } = await storage.from("staging").upload(
      pendingObjectPath(bookId, object.path),
      object.bytes,
      { upsert: true, contentType: "application/octet-stream" },
    );
    if (error) {
      return jsonResponse(
        { ok: false, message: "Could not stage the preview. Try again." },
        500,
      );
    }
  }

  const { error: manifestError } = await storage.from("staging").upload(
    pendingManifestPath(bookId),
    new TextEncoder().encode(JSON.stringify(manifest)),
    { upsert: true, contentType: "application/json" },
  );
  if (manifestError) {
    return jsonResponse(
      { ok: false, message: "Could not stage the preview. Try again." },
      500,
    );
  }

  return jsonResponse({
    ok: true,
    bookName: book.name,
    segments: preview.firstTwentySegments,
    removedTagCount: preview.removedTagCount,
  });
});

async function latestVersionHash(
  supabase: SupabaseClient,
  bookId: string,
  latestVersionNumber: number,
): Promise<string | null> {
  if (latestVersionNumber === 0) {
    return null;
  }

  const { data } = await supabase
    .from("versions")
    .select("hash")
    .eq("book_id", bookId)
    .eq("version_number", latestVersionNumber)
    .maybeSingle();

  return data?.hash ?? null;
}

/**
 * ADR-0015: everything under the Book's staging prefix is deleted before a new bundle
 * is written, not merely overwritten — an asset an earlier abandoned bundle held and
 * this one does not would otherwise survive into a tree that mixes two Uploads. The
 * previous manifest is the one record of exactly what that earlier bundle staged, so
 * it is read back here rather than listed from Storage (which cannot see into nested
 * asset folders in one call).
 */
async function clearPending(
  storage: SupabaseClient["storage"],
  bookId: string,
): Promise<void> {
  const { data: previousManifestFile } = await storage
    .from("staging")
    .download(pendingManifestPath(bookId));
  if (!previousManifestFile) {
    return;
  }

  let previous: PendingManifest;
  try {
    previous = JSON.parse(await previousManifestFile.text());
  } catch {
    return;
  }

  await storage.from("staging").remove([
    pendingManifestPath(bookId),
    ...previous.paths.map((path) => pendingObjectPath(bookId, path)),
  ]);
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}
