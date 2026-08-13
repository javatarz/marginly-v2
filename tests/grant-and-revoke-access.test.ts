import { beforeAll, describe, expect, it } from "vitest";

import { accountId, anonClient, asSuperuser, signedInClient } from "./support/local-stack";

/**
 * Granting and revoking access to a Book (#28), against a real database.
 *
 * `grant_access` is a `security definer` function — no unit test can see its refusals
 * or its account lookup, both of which happen past RLS — so these drive it the way the
 * app will: through a signed-in Author's own token, over seeded accounts and Books.
 */
const AUTHOR = "grant-author@example.com";
const OTHER_AUTHOR = "grant-other-author@example.com";
const REVIEWER = "grant-reviewer@example.com";
const STRANGER = "grant-stranger@example.com";

const NO_ACCOUNT_EMAIL = "grant-no-account@example.com";

// A stored address that does not match what a normalised lookup produces — simulating
// the pre-existing/backfilled rows 20260813140000_users.sql copies from auth.users
// verbatim, with no normalisation of its own.
const MIXED_CASE_REVIEWER = "grant-mixed-case@example.com";
const MIXED_CASE_STORED_ADDRESS = "Grant-Mixed-Case@Example.com";

const READY_BOOK = "cccccccc-0000-4000-8000-000000000001";
const ZERO_VERSION_BOOK = "cccccccc-0000-4000-8000-000000000002";
const REVOKE_TARGET_BOOK = "cccccccc-0000-4000-8000-000000000003";
const EARLY_VERSIONS_BOOK = "cccccccc-0000-4000-8000-000000000004";
const OTHER_AUTHORS_BOOK = "cccccccc-0000-4000-8000-000000000005";
const MIXED_CASE_BOOK = "cccccccc-0000-4000-8000-000000000006";

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
    signedInClient(MIXED_CASE_REVIEWER),
  ]);

  // These tests set up their own pre-state, the same shape
  // tests/versions-policies.test.ts uses: a Version is immutable, so once one exists
  // its Book cannot be deleted even by `on delete cascade` (the trigger cannot tell a
  // cascade from any other DELETE). Books and Versions are therefore upserted
  // idempotently rather than deleted and recreated; `book_reviewers` carries no such
  // trigger, so grants are reset outright, back to a known starting shape each run.
  asSuperuser(`
    delete from public.book_reviewers where book_id in (
      '${READY_BOOK}', '${ZERO_VERSION_BOOK}', '${REVOKE_TARGET_BOOK}',
      '${EARLY_VERSIONS_BOOK}', '${OTHER_AUTHORS_BOOK}', '${MIXED_CASE_BOOK}');

    delete from public.books where id = '${ZERO_VERSION_BOOK}';

    insert into public.books (id, author_id, name, latest_version_number)
    select '${READY_BOOK}', u.id, 'Ready to grant', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${READY_BOOK}', 1, 'grant-test-ready-v1'
    where not exists (
      select 1 from public.versions where book_id = '${READY_BOOK}' and version_number = 1
    );

    insert into public.books (id, author_id, name, latest_version_number)
    select '${ZERO_VERSION_BOOK}', u.id, 'Holds no Versions', 0
    from public.users u where u.email = '${AUTHOR}';

    insert into public.books (id, author_id, name, latest_version_number)
    select '${REVOKE_TARGET_BOOK}', u.id, 'Revoke target', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${REVOKE_TARGET_BOOK}', 1, 'grant-test-revoke-target-v1'
    where not exists (
      select 1 from public.versions
      where book_id = '${REVOKE_TARGET_BOOK}' and version_number = 1
    );

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${REVOKE_TARGET_BOOK}', u.id from public.users u where u.email = '${REVIEWER}';

    -- Both Versions land before the grant below, so "reads every Version, including
    -- ones Uploaded before the grant" has something to actually exercise. Landed one at
    -- a time, bumping the counter first each time: enforce_version_numbering checks the
    -- new row against the Book's *current* latest_version_number, so inserting v1 and
    -- v2 in one statement while the counter already reads 2 would refuse v1 outright.
    insert into public.books (id, author_id, name, latest_version_number)
    select '${EARLY_VERSIONS_BOOK}', u.id, 'Versions before the grant', 0
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do nothing;

    update public.books set latest_version_number = 1 where id = '${EARLY_VERSIONS_BOOK}';
    insert into public.versions (book_id, version_number, hash)
    select '${EARLY_VERSIONS_BOOK}', 1, 'grant-test-early-v1'
    where not exists (
      select 1 from public.versions
      where book_id = '${EARLY_VERSIONS_BOOK}' and version_number = 1
    );

    update public.books set latest_version_number = 2 where id = '${EARLY_VERSIONS_BOOK}';
    insert into public.versions (book_id, version_number, hash)
    select '${EARLY_VERSIONS_BOOK}', 2, 'grant-test-early-v2'
    where not exists (
      select 1 from public.versions
      where book_id = '${EARLY_VERSIONS_BOOK}' and version_number = 2
    );

    insert into public.books (id, author_id, name, latest_version_number)
    select '${OTHER_AUTHORS_BOOK}', u.id, 'Not yours', 1
    from public.users u where u.email = '${OTHER_AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${OTHER_AUTHORS_BOOK}', 1, 'grant-test-other-v1'
    where not exists (
      select 1 from public.versions
      where book_id = '${OTHER_AUTHORS_BOOK}' and version_number = 1
    );

    insert into public.books (id, author_id, name, latest_version_number)
    select '${MIXED_CASE_BOOK}', u.id, 'Mixed case address target', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${MIXED_CASE_BOOK}', 1, 'grant-test-mixed-case-v1'
    where not exists (
      select 1 from public.versions
      where book_id = '${MIXED_CASE_BOOK}' and version_number = 1
    );

    update public.users set email = '${MIXED_CASE_STORED_ADDRESS}'
    where email = '${MIXED_CASE_REVIEWER}';
  `);
}, 120_000);

describe("granting access", () => {
  it("lets an Author grant a Reviewer by email, keyed on the account id", async () => {
    const reviewerId = await accountId(reviewer);

    const { error } = await author.rpc("grant_access", { book: READY_BOOK, email: REVIEWER });
    expect(error).toBeNull();

    const { data } = await author
      .from("book_reviewers")
      .select("reviewer_id, revoked_at")
      .eq("book_id", READY_BOOK)
      .single();

    expect(data).toEqual({ reviewer_id: reviewerId, revoked_at: null });
  });

  it("lowercases and trims the typed address before looking it up", async () => {
    const { error } = await author.rpc("grant_access", {
      book: READY_BOOK,
      email: `  ${REVIEWER.toUpperCase()}  `,
    });

    // Already granted by the previous test once normalised — proof the lookup
    // normalised it rather than failing to find the account at all.
    expect(error?.code).toBe("MG003");
  });

  it("grants the Reviewer reading access to the Book", async () => {
    const { data } = await reviewer.from("books").select("name").eq("id", READY_BOOK);
    expect(data).toEqual([{ name: "Ready to grant" }]);
  });

  it("refuses an address with no account", async () => {
    const { error } = await author.rpc("grant_access", {
      book: READY_BOOK,
      email: NO_ACCOUNT_EMAIL,
    });

    expect(error?.code).toBe("MG001");
  });

  it("refuses a Book that holds no Versions yet", async () => {
    const { error } = await author.rpc("grant_access", {
      book: ZERO_VERSION_BOOK,
      email: REVIEWER,
    });

    expect(error?.code).toBe("MG002");
  });

  // Documents, rather than merely relying on, the order grant_access checks in: a
  // zero-Version Book is refused before the address is even looked up, so a typo'd
  // email on such a Book still reports the Version problem, not the account one.
  it("prefers the zero-Versions refusal over the no-account refusal when both apply", async () => {
    const { error } = await author.rpc("grant_access", {
      book: ZERO_VERSION_BOOK,
      email: NO_ACCOUNT_EMAIL,
    });

    expect(error?.code).toBe("MG002");
  });

  it("refuses a grant that already exists and is not revoked", async () => {
    const { error } = await author.rpc("grant_access", { book: READY_BOOK, email: REVIEWER });
    expect(error?.code).toBe("MG003");
  });

  it("refuses an Author granting access to themselves", async () => {
    const authorId = await accountId(author);

    const { error } = await author.rpc("grant_access", { book: READY_BOOK, email: AUTHOR });
    expect(error?.code).toBe("MG004");

    const { data } = await author
      .from("book_reviewers")
      .select("reviewer_id")
      .eq("book_id", READY_BOOK)
      .eq("reviewer_id", authorId);
    expect(data).toEqual([]);
  });

  it("finds an account even when its stored address is not lowercase", async () => {
    const { error } = await author.rpc("grant_access", {
      book: MIXED_CASE_BOOK,
      email: MIXED_CASE_REVIEWER,
    });

    expect(error).toBeNull();
  });

  it("refuses an Author granting access to a Book they do not own", async () => {
    const { error } = await author.rpc("grant_access", {
      book: OTHER_AUTHORS_BOOK,
      email: REVIEWER,
    });

    expect(error).not.toBeNull();
    expect(error?.code).not.toBe("MG003");
  });

  // ADR-0010: `anon` holds no privilege on anything, and functions are executable by
  // PUBLIC unless told otherwise — `revoke all ... from public` is the line this
  // exercises.
  it("refuses anon calling grant_access outright", async () => {
    const { error } = await anonClient().rpc("grant_access", {
      book: READY_BOOK,
      email: REVIEWER,
    });

    expect(error).not.toBeNull();
  });

  it("refuses a stranger calling grant_access on a Book they do not own", async () => {
    const { error } = await stranger.rpc("grant_access", { book: READY_BOOK, email: STRANGER });
    expect(error).not.toBeNull();
  });

  // `reviewer` genuinely holds a live grant on READY_BOOK by this point (granted at the
  // top of this block) — not merely a Book they have no relationship to at all, which
  // the ownership check alone would already refuse regardless of this rule.
  it("refuses a Reviewer calling grant_access, even on a Book they can already read", async () => {
    const { error } = await reviewer.rpc("grant_access", {
      book: READY_BOOK,
      email: STRANGER,
    });

    expect(error).not.toBeNull();

    const { data } = await author
      .from("book_reviewers")
      .select("reviewer_id")
      .eq("book_id", READY_BOOK);
    // Still only the one grant to REVIEWER — no row landed for STRANGER.
    expect(data).toHaveLength(1);
  });

  it("lets a Reviewer read every Version of a granted Book, including ones Uploaded before the grant", async () => {
    const { error: grantError } = await author.rpc("grant_access", {
      book: EARLY_VERSIONS_BOOK,
      email: REVIEWER,
    });
    expect(grantError).toBeNull();

    const { data } = await reviewer
      .from("versions")
      .select("version_number")
      .eq("book_id", EARLY_VERSIONS_BOOK)
      .order("version_number");

    expect(data).toEqual([{ version_number: 1 }, { version_number: 2 }]);
  });
});

describe("revoking access", () => {
  it("lets an Author revoke a Reviewer's access, marking the row rather than deleting it", async () => {
    const reviewerId = await accountId(reviewer);

    const { error } = await author
      .from("book_reviewers")
      .update({ revoked_at: new Date().toISOString() })
      .eq("book_id", REVOKE_TARGET_BOOK)
      .eq("reviewer_id", reviewerId);

    expect(error).toBeNull();

    const { data } = await author
      .from("book_reviewers")
      .select("revoked_at")
      .eq("book_id", REVOKE_TARGET_BOOK)
      .eq("reviewer_id", reviewerId)
      .single();

    expect(data?.revoked_at).not.toBeNull();
  });

  it("stops the revoked Reviewer reading the Book", async () => {
    const { data } = await reviewer.from("books").select("name").eq("id", REVOKE_TARGET_BOOK);
    expect(data).toEqual([]);
  });

  it("keeps the revoked Reviewer's address readable to the Author", async () => {
    const { data } = await author.from("users").select("email").eq("email", REVIEWER);
    expect(data).toEqual([{ email: REVIEWER }]);
  });

  it("lets granting the same address again clear the mark rather than refusing", async () => {
    const reviewerId = await accountId(reviewer);

    const { error } = await author.rpc("grant_access", {
      book: REVOKE_TARGET_BOOK,
      email: REVIEWER,
    });
    expect(error).toBeNull();

    const { data } = await author
      .from("book_reviewers")
      .select("revoked_at")
      .eq("book_id", REVOKE_TARGET_BOOK)
      .eq("reviewer_id", reviewerId)
      .single();

    expect(data?.revoked_at).toBeNull();

    const { data: readAgain } = await reviewer
      .from("books")
      .select("name")
      .eq("id", REVOKE_TARGET_BOOK);
    expect(readAgain).toEqual([{ name: "Revoke target" }]);
  });

  it("does not let a Reviewer revoke their own access", async () => {
    const reviewerId = await accountId(reviewer);

    await reviewer
      .from("book_reviewers")
      .update({ revoked_at: new Date().toISOString() })
      .eq("book_id", REVOKE_TARGET_BOOK)
      .eq("reviewer_id", reviewerId);

    const { data } = await author
      .from("book_reviewers")
      .select("revoked_at")
      .eq("book_id", REVOKE_TARGET_BOOK)
      .eq("reviewer_id", reviewerId)
      .single();

    expect(data?.revoked_at).toBeNull();
  });

  it("does not let another Author revoke a grant on a Book they do not own", async () => {
    const reviewerId = await accountId(reviewer);

    await otherAuthor
      .from("book_reviewers")
      .update({ revoked_at: new Date().toISOString() })
      .eq("book_id", REVOKE_TARGET_BOOK)
      .eq("reviewer_id", reviewerId);

    const { data } = await author
      .from("book_reviewers")
      .select("revoked_at")
      .eq("book_id", REVOKE_TARGET_BOOK)
      .eq("reviewer_id", reviewerId)
      .single();

    expect(data?.revoked_at).toBeNull();
  });

  it("never deletes the row: no delete grant reaches book_reviewers", async () => {
    const reviewerId = await accountId(reviewer);

    const { error } = await author
      .from("book_reviewers")
      .delete()
      .eq("book_id", REVOKE_TARGET_BOOK)
      .eq("reviewer_id", reviewerId);

    expect(error).not.toBeNull();
  });
});
