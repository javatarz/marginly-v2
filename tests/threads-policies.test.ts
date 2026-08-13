import { beforeAll, describe, expect, it } from "vitest";

import { accountId, anonClient, asSuperuser, signedInClient } from "./support/local-stack";

/**
 * Starting a Thread (#29), against a real database — ADR-0006/ADR-0010/ADR-0014.
 *
 * `start_thread` is `security invoker`, so every refusal below is an ordinary policy or
 * trigger a signed-in client can hit directly; this drives it the way the app will,
 * through a Reviewer's and an Author's own tokens over seeded Books.
 */
const AUTHOR = "thread-author@example.com";
const REVIEWER = "thread-reviewer@example.com";
const STRANGER = "thread-stranger@example.com";

const READY_BOOK = "dddddddd-0000-4000-8000-000000000001";
const TWO_VERSION_BOOK = "dddddddd-0000-4000-8000-000000000002";
const OTHER_BOOK = "dddddddd-0000-4000-8000-000000000003";

type Client = Awaited<ReturnType<typeof signedInClient>>;

let author: Client;
let reviewer: Client;
let stranger: Client;

beforeAll(async () => {
  [author, reviewer, stranger] = await Promise.all([
    signedInClient(AUTHOR),
    signedInClient(REVIEWER),
    signedInClient(STRANGER),
  ]);

  // Idempotent, the same shape tests/versions-policies.test.ts uses: a Version is
  // immutable, so these Books and their Versions are upserted rather than deleted and
  // recreated. Nothing in this ticket bumps `latest_version_number` on its own, so —
  // unlike that file — a repeat run finds these Books at exactly the numbers seeded
  // here; only the Threads under them accumulate across runs.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${READY_BOOK}', u.id, 'Ready for Threads', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${READY_BOOK}', 1, 'thread-test-ready-v1'
    where not exists (
      select 1 from public.versions where book_id = '${READY_BOOK}' and version_number = 1
    );

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${READY_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;

    insert into public.books (id, author_id, name, latest_version_number)
    select '${TWO_VERSION_BOOK}', u.id, 'Two Versions', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${TWO_VERSION_BOOK}', 1, 'thread-test-two-v1'
    where not exists (
      select 1 from public.versions where book_id = '${TWO_VERSION_BOOK}' and version_number = 1
    );

    update public.books set latest_version_number = 2 where id = '${TWO_VERSION_BOOK}';

    insert into public.versions (book_id, version_number, hash)
    select '${TWO_VERSION_BOOK}', 2, 'thread-test-two-v2'
    where not exists (
      select 1 from public.versions where book_id = '${TWO_VERSION_BOOK}' and version_number = 2
    );

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${TWO_VERSION_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;

    insert into public.books (id, author_id, name, latest_version_number)
    select '${OTHER_BOOK}', u.id, 'Not Yours', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${OTHER_BOOK}', 1, 'thread-test-other-v1'
    where not exists (
      select 1 from public.versions where book_id = '${OTHER_BOOK}' and version_number = 1
    );
  `);
}, 120_000);

describe("starting a Thread", () => {
  it("lets a Reviewer start a Thread with its first Comment, in one call", async () => {
    const { data: threadId, error } = await reviewer.rpc("start_thread", {
      book: READY_BOOK,
      range_start: 0,
      range_end: 5,
      selected_text: "hello",
      paragraph_text: "hello world",
      body: "what did you mean here?",
    });

    expect(error).toBeNull();
    expect(threadId).toEqual(expect.any(String));

    const { data: threadVersion } = await reviewer
      .from("thread_versions")
      .select("status, text_position")
      .eq("thread_id", threadId!)
      .eq("version_number", 1)
      .single();

    expect(threadVersion?.status).toBe("linked");

    const { data: comments } = await reviewer
      .from("comments")
      .select("body")
      .eq("thread_id", threadId!);

    expect(comments).toEqual([{ body: "what did you mean here?" }]);
  });

  it("lets an Author start a Thread on their own Book", async () => {
    const { error } = await author.rpc("start_thread", {
      book: READY_BOOK,
      range_start: 6,
      range_end: 11,
      selected_text: "world",
      paragraph_text: "hello world",
      body: "an Author's own Thread",
    });

    expect(error).toBeNull();
  });

  it("refuses a stranger starting a Thread on a Book they may not read", async () => {
    const { error, data } = await stranger.rpc("start_thread", {
      book: READY_BOOK,
      range_start: 0,
      range_end: 5,
      selected_text: "hello",
      paragraph_text: "hello world",
      body: "should never land",
    });

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("refuses anon calling start_thread outright", async () => {
    const { error } = await anonClient().rpc("start_thread", {
      book: READY_BOOK,
      range_start: 0,
      range_end: 5,
      selected_text: "hello",
      paragraph_text: "hello world",
      body: "should never land",
    });

    expect(error).not.toBeNull();
  });

  it("refuses a zero-length selection", async () => {
    const { error } = await author.rpc("start_thread", {
      book: READY_BOOK,
      range_start: 5,
      range_end: 5,
      selected_text: "",
      paragraph_text: "hello world",
      body: "an empty Highlight",
    });

    expect(error).not.toBeNull();
  });
});

describe("there is no empty Thread", () => {
  it("refuses a bare Thread insert with no Comment to follow", async () => {
    const authorId = await accountId(author);

    const { error } = await author.from("threads").insert({
      book_id: READY_BOOK,
      created_by: authorId,
      created_version_number: 1,
      selected_text: "hello",
      paragraph_text: "hello world",
    });

    expect(error).not.toBeNull();
  });
});

describe("a Thread is started only on the latest Version", () => {
  it("refuses a Thread claiming a Version that is not the Book's latest", async () => {
    const authorId = await accountId(author);

    const { error } = await author.from("threads").insert({
      book_id: TWO_VERSION_BOOK,
      created_by: authorId,
      created_version_number: 1,
      selected_text: "hello",
      paragraph_text: "hello world",
    });

    expect(error).not.toBeNull();
  });

  it("refuses a Thread's per-Version row claiming a Version that is not the Book's latest", async () => {
    const { data: threadId, error: startError } = await author.rpc("start_thread", {
      book: TWO_VERSION_BOOK,
      range_start: 0,
      range_end: 4,
      selected_text: "once",
      paragraph_text: "once upon a time",
      body: "on the latest Version",
    });
    expect(startError).toBeNull();

    const { error } = await author.from("thread_versions").insert({
      thread_id: threadId!,
      book_id: TWO_VERSION_BOOK,
      version_number: 1,
      status: "linked",
      text_position: "[0,4)",
    });

    expect(error).not.toBeNull();
  });

  it("refuses a Comment claiming a Version that is not the Book's latest", async () => {
    const { data: threadId, error: startError } = await author.rpc("start_thread", {
      book: TWO_VERSION_BOOK,
      range_start: 5,
      range_end: 9,
      selected_text: "upon",
      paragraph_text: "once upon a time",
      body: "on the latest Version too",
    });
    expect(startError).toBeNull();

    const authorId = await accountId(author);

    const { error } = await author.from("comments").insert({
      thread_id: threadId!,
      book_id: TWO_VERSION_BOOK,
      author_id: authorId,
      version_number: 1,
      body: "backdated",
    });

    expect(error).not.toBeNull();
  });
});

describe("a Comment's book_id is pinned to its Thread's own Book", () => {
  it("refuses a Comment naming a different Book than its Thread", async () => {
    // The Author both starts the Thread and attempts the follow-up insert, and OTHER_BOOK
    // is also theirs — so every policy this insert must pass (can_read_book, author_id =
    // auth.uid(), version_number = that Book's own latest) passes on its own merits. The
    // only thing left to reject it is the composite foreign key: the real Thread names
    // READY_BOOK, and no row in `threads` matches (thread_id, OTHER_BOOK).
    const { data: threadId, error: startError } = await author.rpc("start_thread", {
      book: READY_BOOK,
      range_start: 0,
      range_end: 5,
      selected_text: "hello",
      paragraph_text: "hello world",
      body: "pinned to the right Book",
    });
    expect(startError).toBeNull();

    const authorId = await accountId(author);

    const { error } = await author.from("comments").insert({
      thread_id: threadId!,
      book_id: OTHER_BOOK,
      author_id: authorId,
      version_number: 1,
      body: "wrong Book entirely",
    });

    expect(error).not.toBeNull();
  });
});

describe("reading Threads", () => {
  it("is hidden from a stranger", async () => {
    const { data } = await stranger.from("threads").select("id").eq("book_id", READY_BOOK);
    expect(data).toEqual([]);
  });

  it("refuses anon outright", async () => {
    const { data, error } = await anonClient().from("threads").select("id");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("lets a Reviewer read the Comments on a Thread they did not start", async () => {
    const { data: threadId, error: startError } = await author.rpc("start_thread", {
      book: READY_BOOK,
      range_start: 0,
      range_end: 5,
      selected_text: "hello",
      paragraph_text: "hello world",
      body: "written by the Author",
    });
    expect(startError).toBeNull();

    const { data } = await reviewer.from("comments").select("body").eq("thread_id", threadId!);
    expect(data).toEqual([{ body: "written by the Author" }]);
  });
});

describe("version_threads — the shared read for a Version's discussion", () => {
  it("returns a Linked Thread's range and its Comments together", async () => {
    const { data: threadId, error: startError } = await reviewer.rpc("start_thread", {
      book: READY_BOOK,
      range_start: 0,
      range_end: 5,
      selected_text: "hello",
      paragraph_text: "hello world",
      body: "shows up in version_threads",
    });
    expect(startError).toBeNull();

    const { data, error } = await reviewer.rpc("version_threads", {
      book: READY_BOOK,
      version_number: 1,
    });

    expect(error).toBeNull();
    const row = data?.find((t) => t.thread_id === threadId);
    expect(row).toBeDefined();
    expect(row?.text_position).toBe("[0,5)");
    expect(row?.comments).toEqual([
      expect.objectContaining({ body: "shows up in version_threads" }),
    ]);
  });

  it("returns nothing for a Version with no Threads on it", async () => {
    // TWO_VERSION_BOOK's latest is 2, so nothing this suite starts ever lands a Thread
    // on v1 — every start_thread call above computes the Version from the Book's
    // current latest, never from a caller-supplied number.
    const { data, error } = await author.rpc("version_threads", {
      book: TWO_VERSION_BOOK,
      version_number: 1,
    });

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("is hidden from a stranger", async () => {
    const { data, error } = await stranger.rpc("version_threads", {
      book: READY_BOOK,
      version_number: 1,
    });

    // security invoker: RLS still filters the underlying rows for a stranger, so this
    // reads back empty rather than erroring — the same shape any other read takes.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
