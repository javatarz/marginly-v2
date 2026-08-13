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
 * What `commitVersion` (upload/index.ts) must remove from Storage once its transaction
 * has settled, isolated from the Storage calls themselves so the decision — which
 * bucket, which paths, on success versus failure — is unit-testable without a Storage
 * client. On success only this invocation's own staged copies are stale, since the
 * `versions` copies are now the Version. On failure both sets are, since the copies
 * never became anything (ADR-0009: a copy or staging failure rolls the bump back; this
 * best-effort delete is the optimisation on top, not the guarantee).
 */
export function storageCleanupPlan(
  outcome: "committed" | "failed",
  stagedPaths: readonly string[],
  copiedPaths: readonly string[],
): readonly StorageCleanupStep[] {
  if (outcome === "committed") {
    return stagedPaths.length > 0 ? [{ bucket: "staging", paths: stagedPaths }] : [];
  }

  const steps: StorageCleanupStep[] = [];
  if (copiedPaths.length > 0) {
    steps.push({ bucket: "versions", paths: copiedPaths });
  }
  if (stagedPaths.length > 0) {
    steps.push({ bucket: "staging", paths: stagedPaths });
  }
  return steps;
}
