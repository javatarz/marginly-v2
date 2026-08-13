import { beforeAll, describe, expect, it } from "vitest";

import { asSuperuser, signedInClient } from "./support/local-stack";

/**
 * Who reads and writes a Version's or a staged Upload's Storage objects, against a real
 * database (#25, ADR-0010's "Storage" section).
 *
 * Both buckets name the Book first in the object path, and every policy reads it back
 * out with `(storage.foldername(name))[1]`. This drives the two rules the acceptance
 * criteria name directly: a Reviewer writes to no prefix at all, and an Author writes to
 * no prefix but their own Book's.
 */
const AUTHOR = "storage-author@example.com";
const OTHER_AUTHOR = "storage-other-author@example.com";
const REVIEWER = "storage-reviewer@example.com";
const STRANGER = "storage-stranger@example.com";

const OWN_BOOK = "cccccccc-0000-4000-8000-000000000001";
const OTHER_BOOK = "cccccccc-0000-4000-8000-000000000002";

type Client = Awaited<ReturnType<typeof signedInClient>>;

let author: Client;
let reviewer: Client;
let stranger: Client;

beforeAll(async () => {
  // OTHER_AUTHOR's account only needs to exist, for OTHER_BOOK's author_id to
  // reference — no test acts as them, so signing in is a seeding side effect and
  // nothing here holds onto the client it returns.
  [author, , reviewer, stranger] = await Promise.all([
    signedInClient(AUTHOR),
    signedInClient(OTHER_AUTHOR),
    signedInClient(REVIEWER),
    signedInClient(STRANGER),
  ]);

  // Idempotent rather than delete-and-recreate: a Version is immutable (this ticket's
  // own trigger), and once one exists on a Book, even `on delete cascade` cannot
  // remove it — the trigger has no way to tell a cascade from any other DELETE. Safe
  // to run against whatever an earlier run already left.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${OWN_BOOK}', u.id, 'Own Book', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${OWN_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;

    insert into public.books (id, author_id, name, latest_version_number)
    select '${OTHER_BOOK}', u.id, 'Other Book', 0
    from public.users u where u.email = '${OTHER_AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;
  `);
}, 120_000);

const bytes = () => new Blob(["hello"], { type: "text/plain" });

describe("staging: the Author's alone", () => {
  it("lets the Author write under their own Book's staging prefix", async () => {
    const { error } = await author.storage
      .from("staging")
      .upload(`${OWN_BOOK}/upload.zip`, bytes(), { upsert: true });

    expect(error).toBeNull();
  });

  it("lets the Author read it back", async () => {
    const { data, error } = await author.storage
      .from("staging")
      .download(`${OWN_BOOK}/upload.zip`);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("refuses a Reviewer writing to the Book's staging prefix", async () => {
    const { error } = await reviewer.storage
      .from("staging")
      .upload(`${OWN_BOOK}/upload.zip`, bytes(), { upsert: true });

    expect(error).not.toBeNull();
  });

  it("refuses a Reviewer reading the Book's staging prefix", async () => {
    const { data, error } = await reviewer.storage
      .from("staging")
      .download(`${OWN_BOOK}/upload.zip`);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("refuses an Author writing to another Author's staging prefix", async () => {
    const { error } = await author.storage
      .from("staging")
      .upload(`${OTHER_BOOK}/upload.zip`, bytes(), { upsert: true });

    expect(error).not.toBeNull();
  });

  it("refuses a stranger writing to any staging prefix", async () => {
    const { error } = await stranger.storage
      .from("staging")
      .upload(`${OWN_BOOK}/upload.zip`, bytes(), { upsert: true });

    expect(error).not.toBeNull();
  });
});

// Version objects are never rewritten (no update policy on the bucket, to match the
// table's own immutability) — so, unlike staging, a repeat run cannot reuse the same
// path with `upsert: true`: Storage treats a write to an existing key as an update,
// which the policy correctly refuses regardless of who is asking. Each run's own
// random Version number keeps these paths fresh every time, exactly as the real
// Upload always writes to a Version number no earlier run ever touched.
const VERSION = () => crypto.randomUUID();

describe("versions: readable by whoever may read the Book, writable only by the Author", () => {
  const versionPath = VERSION();

  it("lets the Author write their own Book's Version objects", async () => {
    const { error } = await author.storage
      .from("versions")
      .upload(`${OWN_BOOK}/${versionPath}/index.html`, bytes());

    expect(error).toBeNull();
  });

  it("is read by a Reviewer granted the Book", async () => {
    const { data, error } = await reviewer.storage
      .from("versions")
      .download(`${OWN_BOOK}/${versionPath}/index.html`);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("hides a Version's objects from a stranger", async () => {
    const { data, error } = await stranger.storage
      .from("versions")
      .download(`${OWN_BOOK}/${versionPath}/index.html`);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("refuses a Reviewer writing to any Version prefix", async () => {
    const { error } = await reviewer.storage
      .from("versions")
      .upload(`${OWN_BOOK}/${VERSION()}/index.html`, bytes());

    expect(error).not.toBeNull();
  });

  it("refuses an Author writing to another Author's Version prefix", async () => {
    const { error } = await author.storage
      .from("versions")
      .upload(`${OTHER_BOOK}/${VERSION()}/index.html`, bytes());

    expect(error).not.toBeNull();
  });
});
