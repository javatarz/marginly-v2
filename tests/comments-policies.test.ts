import { beforeAll, describe, expect, it } from "vitest";

import { accountId, anonClient, asSuperuser, signedInClient } from "./support/local-stack";

/**
 * Commenting on a Thread (#30), against a real database — ADR-0006/ADR-0010.
 *
 * `add_comment` is `security invoker`, so every refusal below is an ordinary policy or
 * trigger a signed-in client can hit directly, the same shape tests/threads-policies.test.ts
 * already uses for `start_thread`.
 */
const AUTHOR = "comment-author@example.com";
const REVIEWER = "comment-reviewer@example.com";
const STRANGER = "comment-stranger@example.com";

const READY_BOOK = "ffffffff-0000-4000-8000-000000000001";
// Seeded at latest Version 1 with a Version 2 row already on disk, so a single test can
// bump `latest_version_number` to 2 mid-run (ADR-0006's freeze) without inserting a new
// Version row itself — the same "already-bumped" trick tests/threads-policies.test.ts
// uses for TWO_VERSION_BOOK, but writable mid-suite since nothing else here depends on
// this Book staying at 1.
const FREEZE_BOOK = "ffffffff-0000-4000-8000-000000000002";

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

  // Idempotent: a repeat run always finds these Books at exactly the numbers seeded
  // here (FREEZE_BOOK's latest is reset to 1 every run, even if a previous run bumped
  // it to 2), so the freeze test below is self-contained regardless of run history.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${READY_BOOK}', u.id, 'Ready for Comments', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name,
      latest_version_number = excluded.latest_version_number;

    insert into public.versions (book_id, version_number, hash)
    select '${READY_BOOK}', 1, 'comment-test-ready-v1'
    where not exists (
      select 1 from public.versions where book_id = '${READY_BOOK}' and version_number = 1
    );

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${READY_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;

    -- enforce_version_numbering requires a Version's own number to equal
    -- latest_version_number at the moment it is inserted, so Version 2 is seeded only
    -- after bumping the counter to 2 — then reset to 1, which is this Book's starting
    -- point for every run regardless of what a previous run left it at.
    insert into public.books (id, author_id, name, latest_version_number)
    select '${FREEZE_BOOK}', u.id, 'Freezes Mid-Suite', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name,
      latest_version_number = 1;

    insert into public.versions (book_id, version_number, hash)
    select '${FREEZE_BOOK}', 1, 'comment-test-freeze-v1'
    where not exists (
      select 1 from public.versions where book_id = '${FREEZE_BOOK}' and version_number = 1
    );

    update public.books set latest_version_number = 2 where id = '${FREEZE_BOOK}';

    insert into public.versions (book_id, version_number, hash)
    select '${FREEZE_BOOK}', 2, 'comment-test-freeze-v2'
    where not exists (
      select 1 from public.versions where book_id = '${FREEZE_BOOK}' and version_number = 2
    );

    update public.books set latest_version_number = 1 where id = '${FREEZE_BOOK}';

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${FREEZE_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;
  `);
}, 120_000);

async function startThread(client: Client, body: string): Promise<string> {
  const { data, error } = await client.rpc("start_thread", {
    book: READY_BOOK,
    range_start: 0,
    range_end: 5,
    selected_text: "hello",
    paragraph_text: "hello world",
    body,
  });
  expect(error).toBeNull();
  return data!;
}

describe("adding a Comment to an existing Thread", () => {
  it("lets a Reviewer add a Comment, its Version computed from the Book's latest", async () => {
    const threadId = await startThread(author, "the first Comment");

    const { data: commentId, error } = await reviewer.rpc("add_comment", {
      thread: threadId,
      body: "a reply from the Reviewer",
    });

    expect(error).toBeNull();
    expect(commentId).toEqual(expect.any(String));

    const { data: comment } = await reviewer
      .from("comments")
      .select("body, version_number, author_id")
      .eq("id", commentId!)
      .single();

    expect(comment?.body).toBe("a reply from the Reviewer");
    expect(comment?.version_number).toBe(1);
    expect(comment?.author_id).toBe(await accountId(reviewer));
  });

  it("lets the Author add a Comment on their own Book", async () => {
    const threadId = await startThread(reviewer, "started by the Reviewer");

    const { error } = await author.rpc("add_comment", {
      thread: threadId,
      body: "a reply from the Author",
    });

    expect(error).toBeNull();
  });

  it("refuses a stranger adding a Comment to a Thread they may not read", async () => {
    const threadId = await startThread(author, "not for strangers");

    const { data, error } = await stranger.rpc("add_comment", {
      thread: threadId,
      body: "should never land",
    });

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("refuses anon calling add_comment outright", async () => {
    const threadId = await startThread(author, "not for anon");

    const { error } = await anonClient().rpc("add_comment", {
      thread: threadId,
      body: "should never land",
    });

    expect(error).not.toBeNull();
  });
});

describe("every commenter's role is derivable from who wrote it", () => {
  it("lets a Reviewer read who wrote each Comment, Author and Reviewer alike", async () => {
    const threadId = await startThread(author, "written by the Author");
    await author.rpc("add_comment", { thread: threadId, body: "still the Author" });
    const { data: reviewerCommentId } = await reviewer.rpc("add_comment", {
      thread: threadId,
      body: "now the Reviewer",
    });
    expect(reviewerCommentId).toEqual(expect.any(String));

    const { data: comments } = await reviewer
      .from("comments")
      .select("body, author_id")
      .eq("thread_id", threadId)
      .order("created_at");

    expect(comments?.map((c) => c.author_id)).toEqual([
      await accountId(author),
      await accountId(author),
      await accountId(reviewer),
    ]);
  });
});

describe("editing a Comment", () => {
  it("lets whoever wrote a Comment edit it while its Version is the latest", async () => {
    const threadId = await startThread(author, "original wording");
    const { data: commentId } = await reviewer.rpc("add_comment", {
      thread: threadId,
      body: "before the edit",
    });

    const { error } = await reviewer
      .from("comments")
      .update({ body: "after the edit" })
      .eq("id", commentId!);

    expect(error).toBeNull();

    const { data: comment } = await reviewer
      .from("comments")
      .select("body")
      .eq("id", commentId!)
      .single();

    expect(comment?.body).toBe("after the edit");
  });

  it("refuses editing another person's Comment", async () => {
    const threadId = await startThread(author, "an Author's Comment");

    const { error } = await reviewer
      .from("comments")
      .update({ body: "hijacked" })
      .eq("thread_id", threadId);

    expect(error).toBeNull(); // RLS filters the row rather than raising — nothing matched.

    const { data: comment } = await author
      .from("comments")
      .select("body")
      .eq("thread_id", threadId)
      .single();

    expect(comment?.body).toBe("an Author's Comment");
  });

  it("refuses editing a Comment once its Version is no longer the Book's latest", async () => {
    const { data: threadId, error: startError } = await author.rpc("start_thread", {
      book: FREEZE_BOOK,
      range_start: 0,
      range_end: 4,
      selected_text: "once",
      paragraph_text: "once upon a time",
      body: "before the freeze",
    });
    expect(startError).toBeNull();

    asSuperuser(`
      update public.books set latest_version_number = 2 where id = '${FREEZE_BOOK}';
    `);

    const { error } = await author
      .from("comments")
      .update({ body: "too late" })
      .eq("thread_id", threadId!);

    expect(error).not.toBeNull();
  });
});

describe("deleting a Comment", () => {
  it("refuses deleting another person's Comment", async () => {
    const threadId = await startThread(author, "kept");
    const { data: reviewerCommentId } = await reviewer.rpc("add_comment", {
      thread: threadId,
      body: "not the Author's to delete",
    });

    const { error } = await author.from("comments").delete().eq("id", reviewerCommentId!);
    expect(error).toBeNull(); // RLS filters the row rather than raising — nothing matched.

    const { data: comment } = await reviewer
      .from("comments")
      .select("body")
      .eq("id", reviewerCommentId!)
      .single();

    expect(comment?.body).toBe("not the Author's to delete");
  });

  it("refuses deleting a Comment once its Version is no longer the Book's latest", async () => {
    asSuperuser(`update public.books set latest_version_number = 1 where id = '${FREEZE_BOOK}';`);

    const { data: threadId, error: startError } = await author.rpc("start_thread", {
      book: FREEZE_BOOK,
      range_start: 5,
      range_end: 9,
      selected_text: "upon",
      paragraph_text: "once upon a time",
      body: "before the second freeze",
    });
    expect(startError).toBeNull();

    asSuperuser(`update public.books set latest_version_number = 2 where id = '${FREEZE_BOOK}';`);

    const { error } = await author.from("comments").delete().eq("thread_id", threadId!);
    expect(error).not.toBeNull();
  });

  it("leaves the Thread when a Comment is deleted but others remain", async () => {
    const threadId = await startThread(author, "stays");
    const { data: secondCommentId } = await author.rpc("add_comment", {
      thread: threadId,
      body: "also deleted",
    });

    const { error } = await author.from("comments").delete().eq("id", secondCommentId!);
    expect(error).toBeNull();

    const { data: thread } = await author.from("threads").select("id").eq("id", threadId).maybeSingle();
    expect(thread).not.toBeNull();
  });

  it("deletes the Thread when its last Comment is deleted", async () => {
    const threadId = await startThread(author, "the only Comment");

    const { data: comment } = await author
      .from("comments")
      .select("id")
      .eq("thread_id", threadId)
      .single();

    const { error } = await author.from("comments").delete().eq("id", comment!.id);
    expect(error).toBeNull();

    const { data: thread } = await author.from("threads").select("id").eq("id", threadId).maybeSingle();
    expect(thread).toBeNull();

    const { data: threadVersion } = await author
      .from("thread_versions")
      .select("thread_id")
      .eq("thread_id", threadId)
      .maybeSingle();
    expect(threadVersion).toBeNull();
  });
});
