import { beforeAll, describe, expect, it } from "vitest";

import { asSuperuser, signedInClient } from "./support/local-stack";
import { buildZip } from "./support/zip";

/**
 * The Upload act itself, end to end (#25) — the tracer bullet ADR-0009 and ADR-0015
 * describe, straight through with no preview or confirm step (#26 inserts that later).
 *
 * This exercises the whole path the unit and policy tests cannot: the browser's zip
 * lands in Storage, the `upload` Edge Function reads it back as the Author, runs the
 * preview seam, stages the sanitised output, and opens a raw Postgres connection
 * through Supavisor in transaction mode to bump the counter, copy the staged objects
 * and insert the `versions` row — one transaction, as the Author, under `set local
 * role` and `set local request.jwt.claims`.
 */
const AUTHOR = "upload-author@example.com";
const BOOK = "dddddddd-0000-4000-8000-000000000001";
const NO_INDEX_BOOK = "dddddddd-0000-4000-8000-000000000002";

type Client = Awaited<ReturnType<typeof signedInClient>>;

let author: Client;

beforeAll(async () => {
  author = await signedInClient(AUTHOR);

  // Idempotent, like versions-policies.test.ts: a Version is immutable, so a Book that
  // already holds one from an earlier run cannot be deleted and recreated.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${BOOK}', u.id, 'Upload Target', 0
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id;

    insert into public.books (id, author_id, name, latest_version_number)
    select '${NO_INDEX_BOOK}', u.id, 'No Index Target', 0
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id;
  `);
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

const VALID_ZIP = buildZip([
  { path: "index.html", content: "<p>Hello <script>alert(1)</script>World</p>" },
  { path: "images/fig1.png", content: new Uint8Array([137, 80, 78, 71]) },
  { path: "style.css", content: "p { color: red; }" },
]);

describe("uploading a Version, straight through", () => {
  it("lands the next Version, sanitised, with its assets and extracted text", async () => {
    const before = await latestVersionNumber(BOOK);
    await stageZip(BOOK, VALID_ZIP);

    const { data, error } = await author.functions.invoke<
      { ok: true; versionNumber: number } | { ok: false; message: string }
    >("upload", { body: { bookId: BOOK } });

    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    if (!data?.ok) {
      throw new Error("expected the Upload to succeed");
    }
    expect(data.versionNumber).toBe(before + 1);

    const { data: version } = await author
      .from("versions")
      .select("version_number")
      .eq("book_id", BOOK)
      .eq("version_number", data.versionNumber)
      .maybeSingle();
    expect(version).not.toBeNull();

    const { data: book } = await author
      .from("books")
      .select("latest_version_number")
      .eq("id", BOOK)
      .single();
    expect(book?.latest_version_number).toBe(data.versionNumber);

    const prefix = `${BOOK}/${data.versionNumber}`;

    const html = await author.storage.from("versions").download(`${prefix}/index.html`);
    expect(html.error).toBeNull();
    const htmlText = await html.data?.text();
    expect(htmlText).not.toContain("<script");
    expect(htmlText).toContain("World");

    const text = await author.storage.from("versions").download(`${prefix}/text.txt`);
    expect(text.error).toBeNull();
    expect(await text.data?.text()).toBe("Hello World");

    const asset = await author.storage
      .from("versions")
      .download(`${prefix}/images/fig1.png`);
    expect(asset.error).toBeNull();

    const stylesheet = await author.storage
      .from("versions")
      .download(`${prefix}/style.css`);
    expect(stylesheet.error).not.toBeNull();

    // The staging prefix is cleared once the Version has landed.
    const staged = await author.storage.from("staging").download(`${BOOK}/upload.zip`);
    expect(staged.error).not.toBeNull();
  });

  it("refuses a zip with no root index.html and creates no Version", async () => {
    const before = await latestVersionNumber(NO_INDEX_BOOK);
    const zip = buildZip([{ path: "chapter.html", content: "<p>one</p>" }]);
    await stageZip(NO_INDEX_BOOK, zip);

    const { error } = await author.functions.invoke<
      { ok: true; versionNumber: number } | { ok: false; message: string }
    >("upload", { body: { bookId: NO_INDEX_BOOK } });

    expect(error).not.toBeNull();

    const after = await latestVersionNumber(NO_INDEX_BOOK);
    expect(after).toBe(before);
  });

  // ADR-0009: the bump's row lock is what makes two concurrent Uploads on one Book
  // stack rather than collide. Both invocations read the same staged zip — nothing
  // about the Edge Function consumes it — and each lands its own next Version number.
  it("stacks two concurrent Uploads on the same Book rather than colliding", async () => {
    const before = await latestVersionNumber(BOOK);
    await stageZip(BOOK, VALID_ZIP);

    const invoke = () =>
      author.functions.invoke<
        { ok: true; versionNumber: number } | { ok: false; message: string }
      >("upload", { body: { bookId: BOOK } });

    const [first, second] = await Promise.all([invoke(), invoke()]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data?.ok).toBe(true);
    expect(second.data?.ok).toBe(true);

    const numbers = [first.data, second.data]
      .map((result) => (result?.ok ? result.versionNumber : null))
      .sort((a, b) => (a ?? 0) - (b ?? 0));

    expect(numbers).toEqual([before + 1, before + 2]);
  });
});
