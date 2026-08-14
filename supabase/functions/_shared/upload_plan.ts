import { isStylesheet } from "./preview/hash.ts";
import type { UnzippedFile } from "./preview/unzip.ts";
import type { PreviewSuccess } from "./preview.ts";

export type PlannedObject = {
  readonly path: string;
  readonly bytes: Uint8Array;
};

const INDEX_HTML = "index.html";
const EXTRACTED_TEXT = "text.txt";
const ZIP = "upload.zip";
const PENDING = "pending";
const MANIFEST = "manifest.json";

/**
 * What a Version's Storage prefix holds, once the preview seam has already sanitised
 * and extracted it: the sanitised `index.html` and the extracted text it never carried
 * before, plus every asset the zip held at its original relative path (ADR-0005) —
 * everything except a non-root `.html` file and any stylesheet, both of which ADR-0005
 * and ADR-0012 say a Version never stores.
 */
export function planVersionObjects(
  files: readonly UnzippedFile[],
  preview: PreviewSuccess,
): readonly PlannedObject[] {
  const encoder = new TextEncoder();
  const assets = files.filter((file) =>
    file.path !== INDEX_HTML &&
    !file.path.toLowerCase().endsWith(".html") &&
    !isStylesheet(file.path)
  );

  return [
    { path: INDEX_HTML, bytes: encoder.encode(preview.html) },
    { path: EXTRACTED_TEXT, bytes: encoder.encode(preview.text) },
    ...assets,
  ];
}

/** The raw zip: `{book_id}/upload.zip`, the Author's alone (ADR-0008). */
export function stagingZipPath(bookId: string): string {
  return `${bookId}/${ZIP}`;
}

/**
 * Where a preview stages its sanitised bundle — `{book_id}/pending/…` — for a later,
 * separate confirm call to copy into a Version (ADR-0009/ADR-0015). A Book holds at
 * most one: a fresh preview clears this whole prefix before writing its own.
 */
export function pendingPrefix(bookId: string): string {
  return `${bookId}/${PENDING}`;
}

export function pendingObjectPath(bookId: string, relativePath: string): string {
  return `${pendingPrefix(bookId)}/${relativePath}`;
}

/** Where the preview staged the new Version's extracted text — the confirm's carry (#33) reads it from here to match against. */
export function pendingExtractedTextPath(bookId: string): string {
  return pendingObjectPath(bookId, EXTRACTED_TEXT);
}

/**
 * `{book_id}/pending/manifest.json` — the one file that makes the pending prefix
 * self-describing. There is deliberately no job record in the database (ADR-0015), so
 * the confirm has to learn what the preview staged, and a later preview has to learn
 * what an earlier one left behind, from Storage alone: the manifest's `paths` is both
 * "what to copy" for the confirm and "what to delete" for the next preview's clear.
 */
export function pendingManifestPath(bookId: string): string {
  return `${pendingPrefix(bookId)}/${MANIFEST}`;
}

export type PendingManifest = {
  readonly hash: string;
  readonly paths: readonly string[];
};

export function planPendingManifest(
  objects: readonly PlannedObject[],
  hash: string,
): PendingManifest {
  return { hash, paths: objects.map((object) => object.path) };
}

/**
 * ADR-0015: an Upload whose hash matches the latest Version is refused outright, with
 * no preview to confirm and no override. A Book holding no Version yet has nothing to
 * match against, so `null` never counts as a duplicate.
 */
export function isDuplicateOfLatest(
  newHash: string,
  latestHash: string | null,
): boolean {
  return latestHash !== null && latestHash === newHash;
}

/**
 * `{book_id}/{version_number}/…` — the Version's prefix, computed and never supplied
 * by a caller. Used both for the Version's real objects (in the `versions` bucket) and
 * for staging this invocation's own sanitised output on its way there (in `staging`):
 * two concurrent Uploads land on two different version numbers (the bump's row lock —
 * ADR-0009), so scoping the staging write by that same number is what keeps their
 * copies from racing over one shared path.
 */
export function versionObjectPath(
  bookId: string,
  versionNumber: number,
  relativePath: string,
): string {
  return `${bookId}/${versionNumber}/${relativePath}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Book id is a `books.id` uuid — anything else can never match a row. */
export function isBookId(value: string): boolean {
  return UUID.test(value);
}

export type StorageCleanupStep = {
  readonly bucket: "staging" | "versions";
  readonly paths: readonly string[];
};

/**
 * What `commitVersion` (upload-confirm/index.ts) must remove from Storage once its
 * transaction has settled, isolated from the Storage calls themselves so the decision —
 * which bucket, which paths, on success versus failure — is unit-testable without a
 * Storage client.
 *
 * On success the whole staged bundle (the raw zip, the manifest and every pending
 * object) is now stale, since the `versions` copies are the Version. On failure none of
 * it is touched: ADR-0009/ADR-0015 want a failed confirm to leave the preview standing,
 * so the Author retries without re-previewing or re-sending up to 50 MB, and only the
 * copies that did land in `versions` — dead bytes no row points at — are worth a
 * best-effort compensating delete (the transaction rollback is the guarantee; this is
 * the optimisation on top).
 */
export function confirmCleanupPlan(
  outcome: "committed" | "failed",
  stagingPaths: readonly string[],
  copiedPaths: readonly string[],
): readonly StorageCleanupStep[] {
  if (outcome === "committed") {
    return stagingPaths.length > 0 ? [{ bucket: "staging", paths: stagingPaths }] : [];
  }

  return copiedPaths.length > 0 ? [{ bucket: "versions", paths: copiedPaths }] : [];
}
