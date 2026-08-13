import { beforeAll, describe, expect, it } from "vitest";

import { accountId, anonClient, asSuperuser, signedInClient } from "./support/local-stack";

/**
 * Who reads a Book, against a real database.
 *
 * ADR-0010 puts this boundary in Postgres because Supabase publishes every table over
 * HTTP, and it warns that a table without a policy fails **open** and looks finished. No
 * unit test can see either of those, so these drive the rules the way a client will —
 * through `can_read_book`, from four seeded accounts.
 */
const AUTHOR = "book-author@example.com";
const OTHER_AUTHOR = "book-other-author@example.com";
const REVIEWER = "book-reviewer@example.com";
const STRANGER = "book-stranger@example.com";

// A Reviewer whose every grant is marked. The Reviewer above keeps a live grant on
// "Granted", which would hide a rule that turns on the reader still having one.
const REVOKED_ONLY = "book-revoked-only@example.com";

const OWNED = "aaaaaaaa-0000-4000-8000-000000000001";
const GRANTED = "aaaaaaaa-0000-4000-8000-000000000002";
const REVOKED = "aaaaaaaa-0000-4000-8000-000000000003";
const PRIVATE_TO_OTHER = "aaaaaaaa-0000-4000-8000-000000000004";

// Rows the "creating a Book" tests below insert through the real policy, rather than as
// superuser fixtures — named ids so a second run cleans up the first's instead of
// colliding with it.
const CREATED_BY_AUTHOR = "aaaaaaaa-0000-4000-8000-000000000005";
const CREATED_BY_OTHER_AUTHOR = "aaaaaaaa-0000-4000-8000-000000000006";

// #23's fixtures: a zero-Version Book to rename, a zero-Version Book to actually delete,
// and one holding a Version so "cannot be deleted by any route" has something to refuse.
const RENAME_TARGET = "aaaaaaaa-0000-4000-8000-000000000007";
const DELETE_TARGET = "aaaaaaaa-0000-4000-8000-000000000008";
const WITH_VERSION = "aaaaaaaa-0000-4000-8000-000000000009";

type Client = Awaited<ReturnType<typeof signedInClient>>;

let author: Client;
let otherAuthor: Client;
let reviewer: Client;
let stranger: Client;
let revokedOnly: Client;

beforeAll(async () => {
  [author, otherAuthor, reviewer, stranger, revokedOnly] = await Promise.all([
    signedInClient(AUTHOR),
    signedInClient(OTHER_AUTHOR),
    signedInClient(REVIEWER),
    signedInClient(STRANGER),
    signedInClient(REVOKED_ONLY),
  ]);

  // These tests set up their own pre-state. The rows are named rather than inherited from
  // whatever a previous run left behind, and removed first so a second run reads the same
  // as the first.
  asSuperuser(`
    delete from public.books where id in (
      '${OWNED}', '${GRANTED}', '${REVOKED}', '${PRIVATE_TO_OTHER}',
      '${CREATED_BY_AUTHOR}', '${CREATED_BY_OTHER_AUTHOR}',
      '${RENAME_TARGET}', '${DELETE_TARGET}', '${WITH_VERSION}');

    insert into public.books (id, author_id, name, created_at)
    select '${OWNED}', u.id, 'Owned', '2026-08-01T09:00:00Z'
    from public.users u where u.email = '${AUTHOR}';

    insert into public.books (id, author_id, name, created_at)
    select '${GRANTED}', u.id, 'Granted', '2026-08-02T09:00:00Z'
    from public.users u where u.email = '${AUTHOR}';

    insert into public.books (id, author_id, name, created_at)
    select '${REVOKED}', u.id, 'Revoked', '2026-08-03T09:00:00Z'
    from public.users u where u.email = '${AUTHOR}';

    insert into public.books (id, author_id, name, created_at)
    select '${PRIVATE_TO_OTHER}', u.id, 'Private', '2026-08-04T09:00:00Z'
    from public.users u where u.email = '${OTHER_AUTHOR}';

    insert into public.books (id, author_id, name, created_at)
    select '${RENAME_TARGET}', u.id, 'Renamable', '2026-08-05T09:00:00Z'
    from public.users u where u.email = '${AUTHOR}';

    insert into public.books (id, author_id, name, created_at)
    select '${DELETE_TARGET}', u.id, 'Deletable', '2026-08-06T09:00:00Z'
    from public.users u where u.email = '${AUTHOR}';

    insert into public.books (id, author_id, name, latest_version_number, created_at)
    select '${WITH_VERSION}', u.id, 'Holds a Version', 1, '2026-08-07T09:00:00Z'
    from public.users u where u.email = '${AUTHOR}';

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${GRANTED}', u.id from public.users u where u.email = '${REVIEWER}';

    insert into public.book_reviewers (book_id, reviewer_id, revoked_at)
    select '${REVOKED}', u.id, now()
    from public.users u where u.email = '${REVIEWER}';

    insert into public.book_reviewers (book_id, reviewer_id, revoked_at)
    select '${REVOKED}', u.id, now()
    from public.users u where u.email = '${REVOKED_ONLY}';
  `);
}, 120_000);

const namesReadBy = async (client: Client) => {
  const { data, error } = await client
    .from("books")
    .select("name")
    .in("id", [OWNED, GRANTED, REVOKED, PRIVATE_TO_OTHER]);

  expect(error).toBeNull();
  return (data ?? []).map((row) => row.name).sort();
};

describe("who reads a Book", () => {
  it("gives an Author their own Books and no Book they do not own", async () => {
    expect(await namesReadBy(author)).toEqual(["Granted", "Owned", "Revoked"]);
  });

  it("gives a Reviewer only the Books granted to them", async () => {
    expect(await namesReadBy(reviewer)).toEqual(["Granted"]);
  });

  it("gives a person nobody granted anything nothing at all", async () => {
    expect(await namesReadBy(stranger)).toEqual([]);
  });

  // ADR-0010: `anon` holds no privilege on anything, so this is a permission error rather
  // than an empty result.
  it("refuses anon the Books outright", async () => {
    const { data, error } = await anonClient().from("books").select("name");

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("refuses anon the grants outright", async () => {
    const { data, error } = await anonClient().from("book_reviewers").select("book_id");

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("refuses a signed-in account a grant of its own invention", async () => {
    const { error } = await stranger
      .from("book_reviewers")
      .insert({ book_id: GRANTED, reviewer_id: crypto.randomUUID() });

    expect(error).not.toBeNull();
  });

  // A Book's Reviewer list is readable by everyone on that Book (ADR-0010): seeing who
  // else is reviewing is the disclosure seeing who wrote each Comment already requires.
  it("shows a Book's grants to everyone on that Book", async () => {
    const { data } = await reviewer
      .from("book_reviewers")
      .select("book_id")
      .eq("book_id", GRANTED);

    expect(data).toHaveLength(1);
  });

  it("hides a Book's grants from a person not on it", async () => {
    const { data } = await stranger
      .from("book_reviewers")
      .select("book_id")
      .eq("book_id", GRANTED);

    expect(data).toEqual([]);
  });
});

/**
 * #22, over the boundary ADR-0010 and ADR-0008 describe: an Author inserts a Book under
 * their own id and no other, the name is refused blank, and it is unique among that
 * Author's own Books — compared trimmed and case-insensitively, and stored exactly as
 * typed.
 */
describe("creating a Book", () => {
  it("lets an Author create a Book under their own id, storing the name exactly as typed", async () => {
    const authorId = await accountId(author);

    // Not `.insert(...).select()`: chaining a select onto an insert asks PostgREST for
    // the row back via `RETURNING`, which re-checks the new row against the *select*
    // policy — `can_read_book`, a `stable security definer` function — in the same
    // command as the not-yet-externally-visible insert. That combination does not see
    // its own row and reports the same "violates row-level security policy" error as a
    // real refusal would, for a row the policy would plainly admit a moment later. A
    // separate, later select does not have that problem, which is why the app's own
    // create action never selects the row back either — it generates the id itself.
    const { error: insertError } = await author
      .from("books")
      .insert({ id: CREATED_BY_AUTHOR, author_id: authorId, name: "  Freshly Made  " });

    expect(insertError).toBeNull();

    const { data } = await author.from("books").select("name").eq("id", CREATED_BY_AUTHOR).single();
    expect(data?.name).toBe("  Freshly Made  ");
  });

  it("refuses a second Book from the same Author with the same name, compared trimmed and case-insensitively", async () => {
    const authorId = await accountId(author);

    const { error } = await author
      .from("books")
      .insert({ author_id: authorId, name: "freshly made" });

    expect(error).not.toBeNull();
  });

  it("does not refuse the same name for a different Author", async () => {
    const otherAuthorId = await accountId(otherAuthor);

    const { error } = await otherAuthor
      .from("books")
      .insert({ id: CREATED_BY_OTHER_AUTHOR, author_id: otherAuthorId, name: "Freshly Made" });

    expect(error).toBeNull();
  });

  it("refuses an empty or whitespace-only name", async () => {
    const authorId = await accountId(author);

    const { error } = await author.from("books").insert({ author_id: authorId, name: "   " });

    expect(error).not.toBeNull();
  });

  it("refuses a Book under an id that is not the caller's own", async () => {
    const { error } = await author
      .from("books")
      .insert({ id: crypto.randomUUID(), author_id: crypto.randomUUID(), name: "Mine" });

    expect(error).not.toBeNull();
  });
});

/**
 * ADR-0011: revoking marks the row rather than deleting it, and `can_read_book` counts
 * only unmarked rows — so reading stops at the revoke while the row stays.
 */
describe("a Reviewer whose access was withdrawn", () => {
  it("stops reading the Book", async () => {
    expect(await namesReadBy(reviewer)).not.toContain("Revoked");
  });

  it("still holds a grant row on it", async () => {
    const { data } = await author
      .from("book_reviewers")
      .select("book_id, revoked_at")
      .eq("book_id", REVOKED);

    expect(data?.map((row) => row.revoked_at === null)).toEqual([false, false]);
  });
});

/**
 * ADR-0010's identity rule, which only became expressible once Books existed: an address
 * is readable where the reader and the subject share a Book, and a marked grant row still
 * counts as sharing one (ADR-0011). That is what keeps a revoked Reviewer's address
 * beside the Comments they wrote.
 */
describe("whose address an account may read", () => {
  const addressesReadBy = async (client: Client, subject: string) => {
    const { data, error } = await client
      .from("users")
      .select("email")
      .eq("email", subject);

    expect(error).toBeNull();
    return (data ?? []).map((row) => row.email);
  };

  it("shows an Author the address of a Reviewer on one of their Books", async () => {
    expect(await addressesReadBy(author, REVIEWER)).toEqual([REVIEWER]);
  });

  it("shows a Reviewer the address of the Author sharing with them", async () => {
    expect(await addressesReadBy(reviewer, AUTHOR)).toEqual([AUTHOR]);
  });

  it("shows nobody the address of a person they share no Book with", async () => {
    expect(await addressesReadBy(stranger, AUTHOR)).toEqual([]);
  });

  // This Reviewer holds one grant row and it is marked. Their address stays readable to
  // the Author on the strength of that marked row alone — which is the whole point of
  // ADR-0011 marking rather than deleting it.
  it("keeps a revoked Reviewer's address readable to the Author", async () => {
    expect(await addressesReadBy(author, REVOKED_ONLY)).toEqual([REVOKED_ONLY]);
  });

  it("stops a revoked Reviewer reading the Book they were revoked from", async () => {
    const { data } = await revokedOnly.from("books").select("name").eq("id", REVOKED);

    expect(data).toEqual([]);
  });

  /**
   * The other direction, which is not the same question.
   *
   * ADR-0011's promise is that a revoked Reviewer's address stays readable *to everyone
   * still on the Book*. It says nothing about what they may still read, and ADR-0010 puts
   * identity behind a Book because "the fact that a particular person is on it at all is
   * itself a disclosure". A revoked Reviewer who kept reading addresses would go on
   * learning who else is on a Book they cannot read — including people granted after they
   * left. Written symmetrically, the rule leaks exactly that.
   */
  it("stops a revoked Reviewer reading the addresses of people still on the Book", async () => {
    expect(await addressesReadBy(revokedOnly, AUTHOR)).toEqual([]);
    expect(await addressesReadBy(revokedOnly, REVIEWER)).toEqual([]);
  });

  // The self-read from 20260813140000_users.sql, which this must not have taken away: an
  // account with no live Book at all still has to be able to read its own address.
  it("still shows a revoked Reviewer their own address", async () => {
    expect(await addressesReadBy(revokedOnly, REVOKED_ONLY)).toEqual([REVOKED_ONLY]);
  });
});

/**
 * #23, over ADR-0008: rename is the Author's own act, refused blank or a collision by
 * the same unique index creating a Book enforces. Nobody else's `update` matches even one
 * row — the policy's `using` clause filters it out before `with check` ever runs, so a
 * blocked rename is a silent no-op rather than an error, the same way a `select` a
 * Reviewer has no access to comes back empty rather than refused.
 */
describe("renaming a Book", () => {
  it("lets an Author rename their own Book", async () => {
    const { error } = await author
      .from("books")
      .update({ name: "Renamed" })
      .eq("id", RENAME_TARGET);

    expect(error).toBeNull();

    const { data } = await author
      .from("books")
      .select("name")
      .eq("id", RENAME_TARGET)
      .single();
    expect(data?.name).toBe("Renamed");
  });

  it("refuses a rename that collides with another of the Author's own Books, compared trimmed and case-insensitively", async () => {
    const { error } = await author
      .from("books")
      .update({ name: "  owned  " })
      .eq("id", RENAME_TARGET);

    expect(error).not.toBeNull();
  });

  it("does not let a Reviewer rename a Book they only review", async () => {
    const { data, error } = await reviewer
      .from("books")
      .update({ name: "Hijacked" })
      .eq("id", GRANTED)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let another Author rename a Book they do not own", async () => {
    const { data, error } = await otherAuthor
      .from("books")
      .update({ name: "Stolen" })
      .eq("id", RENAME_TARGET)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // The rename grant is column-level (`grant update (name) ...`). `latest_version_number`
  // is column-grantable too (#25), for the Upload transaction's raw connection to bump it
  // as the Author — so it no longer proves this rule; `author_id` is never grantable at all.
  it("refuses an Author's own request to change a column no grant covers", async () => {
    const otherAuthorId = await accountId(otherAuthor);

    const { error } = await author
      .from("books")
      .update({ author_id: otherAuthorId })
      .eq("id", RENAME_TARGET);

    expect(error).not.toBeNull();
  });
});

/**
 * #23, over ADR-0008: delete undoes the create step and nothing else, so it only ever
 * removes a Book holding no Versions — enforced by the delete policy's own `using`
 * clause, not by the app. A blocked delete matches no row, the same silent shape as a
 * blocked rename above.
 */
describe("deleting a Book", () => {
  it("does not let a Reviewer delete a Book they only review", async () => {
    const { data, error } = await reviewer.from("books").delete().eq("id", GRANTED).select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let another Author delete a Book they do not own", async () => {
    const { data, error } = await otherAuthor
      .from("books")
      .delete()
      .eq("id", DELETE_TARGET)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("refuses to delete a Book that holds a Version, even for its own Author", async () => {
    const { data, error } = await author
      .from("books")
      .delete()
      .eq("id", WITH_VERSION)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: stillThere } = await author
      .from("books")
      .select("id")
      .eq("id", WITH_VERSION)
      .maybeSingle();
    expect(stillThere?.id).toBe(WITH_VERSION);
  });

  it("lets an Author delete their own Book that holds no Versions", async () => {
    const { data, error } = await author
      .from("books")
      .delete()
      .eq("id", DELETE_TARGET)
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: goneNow } = await author
      .from("books")
      .select("id")
      .eq("id", DELETE_TARGET)
      .maybeSingle();
    expect(goneNow).toBeNull();
  });
});
