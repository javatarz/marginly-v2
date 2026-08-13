import { beforeAll, describe, expect, it } from "vitest";

import { accountId, anonClient, asSuperuser, signedInClient } from "./support/local-stack";

/**
 * Who writes a Version, against a real database (#25).
 *
 * ADR-0009's raw connection is exercised end to end in
 * tests/upload-a-version.test.ts; this drives the same rules the way PostgREST itself
 * would — an Author's own token, straight through `can_read_book`, the Version-only
 * insert policy, and the two triggers.
 */
const AUTHOR = "version-author@example.com";
const OTHER_AUTHOR = "version-other-author@example.com";
const REVIEWER = "version-reviewer@example.com";
const STRANGER = "version-stranger@example.com";

const OWN_BOOK = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_BOOK = "bbbbbbbb-0000-4000-8000-000000000002";

type Client = Awaited<ReturnType<typeof signedInClient>>;

let author: Client;
let otherAuthor: Client;
let reviewer: Client;
let stranger: Client;

beforeAll(async () => {
  [author, otherAuthor, reviewer, stranger] = await Promise.all([
    signedInClient(AUTHOR),
    signedInClient(OTHER_AUTHOR),
    signedInClient(REVIEWER),
    signedInClient(STRANGER),
  ]);

  // Not delete-and-recreate: a Version is immutable (this ticket's own trigger), and
  // once one exists its Book cannot be deleted even by `on delete cascade` — the
  // trigger has no way to tell a cascade from any other DELETE. So this seeds
  // idempotently instead, safe to run against whatever an earlier run already left —
  // including a `latest_version_number` these tests themselves have since bumped.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${OWN_BOOK}', u.id, 'Own Book', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    -- Not an "on conflict do nothing": a BEFORE INSERT trigger fires before Postgres
    -- even checks for a conflict, so enforce_version_numbering would still run against
    -- a row this statement was always going to discard. Guarding the source row with
    -- "where not exists" skips the insert — and the trigger — entirely once the seed
    -- is already there.
    insert into public.versions (book_id, version_number, hash)
    select '${OWN_BOOK}', 1, 'seed-hash-own-book-v1'
    where not exists (
      select 1 from public.versions
      where book_id = '${OWN_BOOK}' and version_number = 1
    );

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${OWN_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;

    insert into public.books (id, author_id, name, latest_version_number)
    select '${OTHER_BOOK}', u.id, 'Other Book', 1
    from public.users u where u.email = '${OTHER_AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${OTHER_BOOK}', 1, 'seed-hash-other-book-v1'
    where not exists (
      select 1 from public.versions
      where book_id = '${OTHER_BOOK}' and version_number = 1
    );
  `);
}, 120_000);

describe("reading a Version", () => {
  // Not an exact-length check: "landing a Version" below bumps OWN_BOOK on every run
  // of this suite, and a Version is immutable — so a repeat run finds it several
  // Versions ahead of the seed's v1, never back at exactly one row.
  it("is read by the Book's Author", async () => {
    const { data } = await author
      .from("versions")
      .select("version_number")
      .eq("book_id", OWN_BOOK)
      .eq("version_number", 1);

    expect(data).toEqual([{ version_number: 1 }]);
  });

  it("is read by a Reviewer granted the Book", async () => {
    const { data } = await reviewer
      .from("versions")
      .select("version_number")
      .eq("book_id", OWN_BOOK)
      .eq("version_number", 1);

    expect(data).toEqual([{ version_number: 1 }]);
  });

  it("is hidden from a stranger", async () => {
    const { data } = await stranger
      .from("versions")
      .select("version_number")
      .eq("book_id", OWN_BOOK);

    expect(data).toEqual([]);
  });

  it("refuses anon outright", async () => {
    const { data, error } = await anonClient().from("versions").select("version_number");

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

// A Version is immutable and only ever numbered upward, so these read the counter
// fresh each time rather than assuming a fixed starting number — a second run of this
// suite finds OWN_BOOK already several Versions ahead of the last one.
async function latestVersionNumber(book: string): Promise<number> {
  const { data } = await author
    .from("books")
    .select("latest_version_number")
    .eq("id", book)
    .single();

  return data?.latest_version_number ?? 0;
}

describe("landing a Version", () => {
  it("lets an Author land the next Version on their own Book", async () => {
    const authorId = await accountId(author);
    const next = (await latestVersionNumber(OWN_BOOK)) + 1;

    await author
      .from("books")
      .update({ latest_version_number: next })
      .eq("id", OWN_BOOK)
      .eq("author_id", authorId);

    const { error } = await author
      .from("versions")
      .insert({ book_id: OWN_BOOK, version_number: next, hash: `test-hash-${next}` });

    expect(error).toBeNull();
  });

  it("refuses a Version numbered anywhere but one past the latest", async () => {
    const wrong = (await latestVersionNumber(OWN_BOOK)) + 50;

    const { error } = await author
      .from("versions")
      .insert({ book_id: OWN_BOOK, version_number: wrong, hash: `test-hash-${wrong}` });

    expect(error).not.toBeNull();
  });

  it("refuses a Reviewer landing a Version on a Book they may read", async () => {
    const next = (await latestVersionNumber(OWN_BOOK)) + 1;

    const { error } = await reviewer
      .from("versions")
      .insert({ book_id: OWN_BOOK, version_number: next, hash: `test-hash-${next}` });

    expect(error).not.toBeNull();
  });

  it("refuses an Author landing a Version on another Author's Book", async () => {
    const { error } = await author
      .from("versions")
      .insert({ book_id: OTHER_BOOK, version_number: 1_000_000, hash: "test-hash-1000000" });

    expect(error).not.toBeNull();
  });
});

describe("a Version is immutable", () => {
  it("refuses an update, even from the Author", async () => {
    const { error } = await author
      .from("versions")
      .update({ version_number: 5 })
      .eq("book_id", OWN_BOOK)
      .eq("version_number", 1);

    expect(error).not.toBeNull();
  });

  it("refuses a delete, even from the Author", async () => {
    const { error } = await author
      .from("versions")
      .delete()
      .eq("book_id", OWN_BOOK)
      .eq("version_number", 1);

    expect(error).not.toBeNull();
  });
});

describe("bumping a Book's Version counter", () => {
  // The Author-only policy filters rows rather than erroring (ADR-0010), so a
  // Reviewer's or another Author's `update` reports success with nothing changed. The
  // assertion is therefore on the counter's value afterwards, read back by the owning
  // Author, rather than on an error.
  it("refuses a Reviewer bumping a Book they may read", async () => {
    await reviewer.from("books").update({ latest_version_number: 9 }).eq("id", OWN_BOOK);

    const { data } = await author
      .from("books")
      .select("latest_version_number")
      .eq("id", OWN_BOOK)
      .single();

    expect(data?.latest_version_number).not.toBe(9);
  });

  it("refuses an Author bumping another Author's Book", async () => {
    await author.from("books").update({ latest_version_number: 9 }).eq("id", OTHER_BOOK);

    const { data } = await otherAuthor
      .from("books")
      .select("latest_version_number")
      .eq("id", OTHER_BOOK)
      .single();

    expect(data?.latest_version_number).not.toBe(9);
  });
});
