import { beforeAll, describe, expect, it } from "vitest";

import { asSuperuser, signedInClient } from "./support/local-stack";
import { buildZip } from "./support/zip";

/**
 * Confirming an Upload from its preview (#26) — ADR-0008/ADR-0009/ADR-0015's two-call
 * split, layered onto the straight-through tracer bullet #25 built.
 *
 * `upload-preview` unzips, hashes, sanitises, extracts and stages the sanitised bundle
 * without touching `versions` or `books`; `upload-confirm` copies that staged bundle
 * into the Version's prefix and opens the one transaction that bumps the counter and
 * inserts the row. This exercises both calls together, end to end, the way the unit
 * and policy tests cannot.
 */
const AUTHOR = "confirm-upload-author@example.com";
const PREVIEW_BOOK = "eeeeeeee-0000-4000-8000-000000000001";
const NO_INDEX_BOOK = "eeeeeeee-0000-4000-8000-000000000002";
const DUPLICATE_BOOK = "eeeeeeee-0000-4000-8000-000000000003";
const OLDER_VERSION_BOOK = "eeeeeeee-0000-4000-8000-000000000004";
const CSS_ONLY_BOOK = "eeeeeeee-0000-4000-8000-000000000005";
const STALE_ASSET_BOOK = "eeeeeeee-0000-4000-8000-000000000006";
const ZIP_LIFECYCLE_BOOK = "eeeeeeee-0000-4000-8000-000000000007";
const FAILED_CONFIRM_BOOK = "eeeeeeee-0000-4000-8000-000000000008";

const BOOKS = [
  PREVIEW_BOOK,
  NO_INDEX_BOOK,
  DUPLICATE_BOOK,
  OLDER_VERSION_BOOK,
  CSS_ONLY_BOOK,
  STALE_ASSET_BOOK,
  ZIP_LIFECYCLE_BOOK,
  FAILED_CONFIRM_BOOK,
];

type Client = Awaited<ReturnType<typeof signedInClient>>;

type PreviewOutcome =
  | { ok: true; bookName: string; segments: string[]; removedTagCount: number }
  | { ok: false; message: string };

type ConfirmOutcome =
  | { ok: true; versionNumber: number }
  | { ok: false; message: string };

let author: Client;

beforeAll(async () => {
  author = await signedInClient(AUTHOR);

  // Idempotent, like versions-policies.test.ts: a Version is immutable, so a Book that
  // already holds one from an earlier run cannot be deleted and recreated.
  asSuperuser(
    BOOKS.map((id, index) => `
      insert into public.books (id, author_id, name, latest_version_number)
      select '${id}', u.id, 'Confirm Target ${index + 1}', 0
      from public.users u where u.email = '${AUTHOR}'
      on conflict (id) do update set author_id = excluded.author_id;
    `).join("\n"),
  );
}, 120_000);

async function latestVersionNumber(book: string): Promise<number> {
  const { data } = await author
    .from("books")
    .select("latest_version_number")
    .eq("id", book)
    .single();

  return data?.latest_version_number ?? 0;
}

async function stageZip(book: string, zip: Uint8Array): Promise<void> {
  const { error } = await author.storage
    .from("staging")
    .upload(`${book}/upload.zip`, zip, {
      upsert: true,
      contentType: "application/zip",
    });

  expect(error).toBeNull();
}

async function invokePreview(book: string) {
  return await author.functions.invoke<PreviewOutcome>("upload-preview", {
    body: { bookId: book },
  });
}

async function invokeConfirm(book: string) {
  return await author.functions.invoke<ConfirmOutcome>("upload-confirm", {
    body: { bookId: book },
  });
}

async function previewAndConfirm(book: string, zip: Uint8Array): Promise<number> {
  await stageZip(book, zip);
  const { data: preview, error: previewError } = await invokePreview(book);
  expect(previewError).toBeNull();
  expect(preview?.ok).toBe(true);

  const { data: confirmed, error: confirmError } = await invokeConfirm(book);
  expect(confirmError).toBeNull();
  expect(confirmed?.ok).toBe(true);
  if (!confirmed?.ok) {
    throw new Error("expected the confirm to succeed");
  }
  return confirmed.versionNumber;
}

async function refusalMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) {
    throw new Error("expected the error to carry a Response context");
  }
  const body = await context.json();
  return body.message;
}

const zip = (entries: { path: string; content: string | Uint8Array }[]) => buildZip(entries);

// A Version is immutable and every confirm here lands a real one, so a second run of
// this suite (without a `supabase db reset` in between) finds each Book already holding
// whatever a previous run confirmed. A fixed content string would then collide with its
// own earlier Version's hash and be refused as a duplicate — this run's own marker
// keeps every confirmed body unique across runs while staying identical within one.
const RUN = Date.now().toString(36);

describe("previewing an Upload", () => {
  it("shows the Book's name, the extracted segments and the removed-tag count, and touches no Version", async () => {
    const before = await latestVersionNumber(PREVIEW_BOOK);
    await stageZip(
      PREVIEW_BOOK,
      zip([{ path: "index.html", content: "<p>Hello <script>alert(1)</script>World</p>" }]),
    );

    const { data, error } = await invokePreview(PREVIEW_BOOK);

    expect(error).toBeNull();
    expect(data).toEqual({
      ok: true,
      bookName: "Confirm Target 1",
      segments: ["Hello World"],
      removedTagCount: 1,
    });

    // Cancelling — never calling confirm — creates no Version.
    expect(await latestVersionNumber(PREVIEW_BOOK)).toBe(before);
  });

  it("refuses a zip with no root index.html and creates no Version", async () => {
    const before = await latestVersionNumber(NO_INDEX_BOOK);
    await stageZip(NO_INDEX_BOOK, zip([{ path: "chapter.html", content: "<p>one</p>" }]));

    const { data, error } = await invokePreview(NO_INDEX_BOOK);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(await refusalMessage(error)).toContain("index.html");
    expect(await latestVersionNumber(NO_INDEX_BOOK)).toBe(before);
  });

  it("refuses an Upload whose hash matches the latest Version outright, with no override", async () => {
    const html = `<p>Duplicate content ${RUN}</p>`;
    const before = await previewAndConfirm(DUPLICATE_BOOK, zip([{ path: "index.html", content: html }]));

    await stageZip(DUPLICATE_BOOK, zip([{ path: "index.html", content: html }]));
    const { data, error } = await invokePreview(DUPLICATE_BOOK);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(await refusalMessage(error)).toContain("identical");
    expect(await latestVersionNumber(DUPLICATE_BOOK)).toBe(before);
  });

  it("accepts an Upload identical to an older, non-latest Version as a genuine new Version", async () => {
    const a = `<p>Version A ${RUN}</p>`;
    const b = `<p>Version B ${RUN}</p>`;

    const v1 = await previewAndConfirm(OLDER_VERSION_BOOK, zip([{ path: "index.html", content: a }]));
    await previewAndConfirm(OLDER_VERSION_BOOK, zip([{ path: "index.html", content: b }]));

    await stageZip(OLDER_VERSION_BOOK, zip([{ path: "index.html", content: a }]));
    const { data: preview, error: previewError } = await invokePreview(OLDER_VERSION_BOOK);
    expect(previewError).toBeNull();
    expect(preview?.ok).toBe(true);

    const { data: confirmed, error: confirmError } = await invokeConfirm(OLDER_VERSION_BOOK);
    expect(confirmError).toBeNull();
    expect(confirmed?.ok).toBe(true);
    if (confirmed?.ok) {
      expect(confirmed.versionNumber).toBe(v1 + 2);
    }
  });

  it("treats a re-export that changes only .css as identical, and creates no Version", async () => {
    const html = `<p>Styled content ${RUN}</p>`;
    const before = await previewAndConfirm(
      CSS_ONLY_BOOK,
      zip([
        { path: "index.html", content: html },
        { path: "style.css", content: "p { color: red; }" },
      ]),
    );

    await stageZip(
      CSS_ONLY_BOOK,
      zip([
        { path: "index.html", content: html },
        { path: "style.css", content: "p { color: blue; }" },
      ]),
    );
    const { data, error } = await invokePreview(CSS_ONLY_BOOK);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(await latestVersionNumber(CSS_ONLY_BOOK)).toBe(before);
  });

  it("clears a previous unconfirmed bundle before staging a new one, so a stale asset cannot land", async () => {
    await stageZip(
      STALE_ASSET_BOOK,
      zip([
        { path: "index.html", content: `<p>First attempt ${RUN}</p>` },
        { path: "images/fig1.png", content: new Uint8Array([137, 80, 78, 71]) },
      ]),
    );
    const first = await invokePreview(STALE_ASSET_BOOK);
    expect(first.data?.ok).toBe(true);

    // A second preview, on the same Book, without confirming the first — it replaces it.
    await stageZip(
      STALE_ASSET_BOOK,
      zip([{ path: "index.html", content: `<p>Second attempt ${RUN}</p>` }]),
    );
    const second = await invokePreview(STALE_ASSET_BOOK);
    expect(second.data?.ok).toBe(true);

    const { data: confirmed, error: confirmError } = await invokeConfirm(STALE_ASSET_BOOK);
    expect(confirmError).toBeNull();
    expect(confirmed?.ok).toBe(true);
    if (!confirmed?.ok) {
      throw new Error("expected the confirm to succeed");
    }

    const html = await author.storage
      .from("versions")
      .download(`${STALE_ASSET_BOOK}/${confirmed.versionNumber}/index.html`);
    expect(await html.data?.text()).toContain(`Second attempt ${RUN}`);

    const asset = await author.storage
      .from("versions")
      .download(`${STALE_ASSET_BOOK}/${confirmed.versionNumber}/images/fig1.png`);
    expect(asset.error).not.toBeNull();
  });

  it("keeps the raw zip staged after a preview, so a retried preview needs no re-send", async () => {
    await stageZip(
      ZIP_LIFECYCLE_BOOK,
      zip([{ path: "index.html", content: `<p>Zip lifecycle ${RUN}</p>` }]),
    );
    const { data } = await invokePreview(ZIP_LIFECYCLE_BOOK);
    expect(data?.ok).toBe(true);

    const stillStaged = await author.storage
      .from("staging")
      .download(`${ZIP_LIFECYCLE_BOOK}/upload.zip`);
    expect(stillStaged.error).toBeNull();

    const { data: confirmed } = await invokeConfirm(ZIP_LIFECYCLE_BOOK);
    expect(confirmed?.ok).toBe(true);

    const clearedAfterConfirm = await author.storage
      .from("staging")
      .download(`${ZIP_LIFECYCLE_BOOK}/upload.zip`);
    expect(clearedAfterConfirm.error).not.toBeNull();
  });
});

describe("confirming a preview", () => {
  it("lands the next Version, sanitised, with its assets and extracted text, and clears the staging prefix", async () => {
    const before = await latestVersionNumber(PREVIEW_BOOK);
    await stageZip(
      PREVIEW_BOOK,
      zip([
        { path: "index.html", content: `<p>Hello <script>alert(1)</script>World ${RUN}</p>` },
        { path: "images/fig1.png", content: new Uint8Array([137, 80, 78, 71]) },
        { path: "style.css", content: "p { color: red; }" },
      ]),
    );
    await invokePreview(PREVIEW_BOOK);

    const { data, error } = await invokeConfirm(PREVIEW_BOOK);

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    if (!data?.ok) {
      throw new Error("expected the confirm to succeed");
    }
    expect(data.versionNumber).toBe(before + 1);

    const { data: version } = await author
      .from("versions")
      .select("version_number")
      .eq("book_id", PREVIEW_BOOK)
      .eq("version_number", data.versionNumber)
      .maybeSingle();
    expect(version).not.toBeNull();

    const { data: book } = await author
      .from("books")
      .select("latest_version_number")
      .eq("id", PREVIEW_BOOK)
      .single();
    expect(book?.latest_version_number).toBe(data.versionNumber);

    const prefix = `${PREVIEW_BOOK}/${data.versionNumber}`;

    const html = await author.storage.from("versions").download(`${prefix}/index.html`);
    expect(html.error).toBeNull();
    const htmlText = await html.data?.text();
    expect(htmlText).not.toContain("<script");
    expect(htmlText).toContain(`World ${RUN}`);

    const text = await author.storage.from("versions").download(`${prefix}/text.txt`);
    expect(text.error).toBeNull();
    expect(await text.data?.text()).toBe(`Hello World ${RUN}`);

    const asset = await author.storage
      .from("versions")
      .download(`${prefix}/images/fig1.png`);
    expect(asset.error).toBeNull();

    const stylesheet = await author.storage
      .from("versions")
      .download(`${prefix}/style.css`);
    expect(stylesheet.error).not.toBeNull();

    const stagedZip = await author.storage.from("staging").download(`${PREVIEW_BOOK}/upload.zip`);
    expect(stagedZip.error).not.toBeNull();

    const stagedManifest = await author.storage
      .from("staging")
      .download(`${PREVIEW_BOOK}/pending/manifest.json`);
    expect(stagedManifest.error).not.toBeNull();
  });

  it("refuses to confirm a Book with no staged preview", async () => {
    const before = await latestVersionNumber(FAILED_CONFIRM_BOOK);

    const { data, error } = await invokeConfirm(FAILED_CONFIRM_BOOK);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(await latestVersionNumber(FAILED_CONFIRM_BOOK)).toBe(before);
  });

  it("leaves no Version and no rows on a failed confirm, with the preview still standing", async () => {
    const before = await latestVersionNumber(FAILED_CONFIRM_BOOK);
    await stageZip(
      FAILED_CONFIRM_BOOK,
      zip([
        { path: "index.html", content: "<p>About to fail</p>" },
        { path: "images/fig1.png", content: new Uint8Array([137, 80, 78, 71]) },
      ]),
    );
    const { data: preview } = await invokePreview(FAILED_CONFIRM_BOOK);
    expect(preview?.ok).toBe(true);

    // Corrupt the staged bundle the same way a transient failure would surface: the
    // confirm's copy of a manifest-listed path has nothing to read.
    const { error: removeError } = await author.storage
      .from("staging")
      .remove([`${FAILED_CONFIRM_BOOK}/pending/images/fig1.png`]);
    expect(removeError).toBeNull();

    const { data, error } = await invokeConfirm(FAILED_CONFIRM_BOOK);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(await latestVersionNumber(FAILED_CONFIRM_BOOK)).toBe(before);

    const { data: versions } = await author
      .from("versions")
      .select("version_number")
      .eq("book_id", FAILED_CONFIRM_BOOK);
    expect(versions).toEqual([]);

    // The preview still stands: the manifest and the zip are both untouched.
    const manifestStillStaged = await author.storage
      .from("staging")
      .download(`${FAILED_CONFIRM_BOOK}/pending/manifest.json`);
    expect(manifestStillStaged.error).toBeNull();

    const zipStillStaged = await author.storage
      .from("staging")
      .download(`${FAILED_CONFIRM_BOOK}/upload.zip`);
    expect(zipStillStaged.error).toBeNull();
  });
});
