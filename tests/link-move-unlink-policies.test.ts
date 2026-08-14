import { beforeAll, describe, expect, it } from "vitest";

import { anonClient, asSuperuser, signedInClient } from "./support/local-stack";

/**
 * Link, move and unlink a Thread (#35), against a real database — ADR-0002/0003/0004/
 * ADR-0006/0010/0014.
 *
 * `link_thread`'s write path (threads-api.ts) is a plain `thread_versions` update: the
 * grant (`status, text_position, thread_position`) and the RLS policy
 * (`can_read_book`, both roles alike) *are* the whole mechanism, so these tests exercise
 * that raw update directly rather than through an RPC. `unlink_thread` is the one RPC —
 * the only write that touches `threads` and `thread_versions` together — so its tests
 * call it by name. The latest-Version trigger
 * (`enforce_thread_version_update_on_latest`) guards both paths identically, since it
 * fires on the `thread_versions` update either one performs.
 */
const AUTHOR = "link-author@example.com";
const REVIEWER = "link-reviewer@example.com";
const STRANGER = "link-stranger@example.com";

const READY_BOOK = "33333333-0000-4000-8000-000000000001";

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

  // Idempotent, the same shape tests/resolve-thread-policies.test.ts uses: a Version is
  // immutable, so these Books and their Versions are upserted rather than deleted and
  // recreated; only the Threads under them accumulate across runs.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${READY_BOOK}', u.id, 'Ready for Link', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name,
      latest_version_number = 1;

    insert into public.versions (book_id, version_number, hash)
    select '${READY_BOOK}', 1, 'link-test-ready-v1'
    where not exists (
      select 1 from public.versions where book_id = '${READY_BOOK}' and version_number = 1
    );

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${READY_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;
  `);
}, 120_000);

/**
 * A fresh, single-Version Book, isolated to whichever test calls this — self-contained
 * both ways (tests-set-up-their-own-pre-state): a random id per call means a test that
 * then supersedes its own v1 never collides with, or depends on the order of, any other
 * test doing the same.
 */
function createOneVersionBook(): string {
  const bookId = crypto.randomUUID();
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${bookId}', u.id, 'Isolated Book ${bookId}', 1
    from public.users u where u.email = '${AUTHOR}';

    insert into public.versions (book_id, version_number, hash)
    values ('${bookId}', 1, 'link-test-${bookId}-v1');
  `);
  return bookId;
}

async function startThread(client: Client, book = READY_BOOK): Promise<string> {
  const { data: threadId, error } = await client.rpc("start_thread", {
    book,
    range_start: 0,
    range_end: 5,
    selected_text: "hello",
    paragraph_text: "hello world",
    body: "a Thread to link, move or unlink",
  });
  expect(error).toBeNull();
  return threadId!;
}

type ThreadVersionRow = {
  status: string;
  text_position: string | null;
  thread_position: number | null;
};

/** Read back through the Author's own client — `thread_versions`' select policy
 * (`can_read_book`) already gives the Author everything a superuser query would, so
 * there is no need to reach past RLS just to assert on it. */
async function threadVersionRow(threadId: string, versionNumber = 1): Promise<ThreadVersionRow | null> {
  const { data } = await author
    .from("thread_versions")
    .select("status, text_position, thread_position")
    .eq("thread_id", threadId)
    .eq("version_number", versionNumber)
    .maybeSingle();
  return (data as ThreadVersionRow | null) ?? null;
}

async function threadTextRow(
  threadId: string,
): Promise<{ selected_text: string | null; paragraph_text: string | null } | null> {
  const { data } = await author
    .from("threads")
    .select("selected_text, paragraph_text")
    .eq("id", threadId)
    .maybeSingle();
  return data ?? null;
}

/** Simulates a carry-time Unlink (#33/#4) without running a whole Upload: flips this
 * Thread's own latest-Version row to Unlinked directly, leaving `threads`' matching
 * text untouched — exactly what the carry itself does, and exactly the starting state
 * "repositioning keeps the text" below needs. */
function markUnlinkedBySuperuser(threadId: string, placement: number): void {
  asSuperuser(`
    update public.thread_versions
    set status = 'unlinked', text_position = null, thread_position = ${placement}
    where thread_id = '${threadId}' and version_number = 1;
  `);
}

describe("linking and moving a Thread onto text", () => {
  it("lets the Author link an Unlinked Thread", async () => {
    const threadId = await startThread(author);
    markUnlinkedBySuperuser(threadId, 5);

    const { error } = await author
      .from("thread_versions")
      .update({ status: "linked", text_position: "[2,7)", thread_position: null })
      .eq("thread_id", threadId)
      .eq("book_id", READY_BOOK)
      .eq("version_number", 1);
    expect(error).toBeNull();

    const row = await threadVersionRow(threadId);
    expect(row).toEqual({ status: "linked", text_position: "[2,7)", thread_position: null });
  });

  it("lets a Reviewer with access link an Unlinked Thread", async () => {
    const threadId = await startThread(reviewer);
    markUnlinkedBySuperuser(threadId, 5);

    const { error } = await reviewer
      .from("thread_versions")
      .update({ status: "linked", text_position: "[1,6)", thread_position: null })
      .eq("thread_id", threadId)
      .eq("book_id", READY_BOOK)
      .eq("version_number", 1);
    expect(error).toBeNull();

    const row = await threadVersionRow(threadId);
    expect(row?.status).toBe("linked");
    expect(row?.text_position).toBe("[1,6)");
  });

  it("lets either role move an already-Linked Thread to different text", async () => {
    const threadId = await startThread(author);

    const { error } = await reviewer
      .from("thread_versions")
      .update({ status: "linked", text_position: "[3,8)", thread_position: null })
      .eq("thread_id", threadId)
      .eq("book_id", READY_BOOK)
      .eq("version_number", 1);
    expect(error).toBeNull();

    const row = await threadVersionRow(threadId);
    expect(row?.text_position).toBe("[3,8)");
  });

  it("leaves a stranger's attempt with no effect", async () => {
    const threadId = await startThread(author);

    await stranger
      .from("thread_versions")
      .update({ status: "linked", text_position: "[9,14)", thread_position: null })
      .eq("thread_id", threadId)
      .eq("book_id", READY_BOOK)
      .eq("version_number", 1);

    const row = await threadVersionRow(threadId);
    expect(row?.text_position).toBe("[0,5)"); // start_thread's own original range, untouched
  });
});

describe("unlinking a Thread deliberately", () => {
  it("discards the Thread's matching text when it was Linked a moment ago", async () => {
    const threadId = await startThread(author);

    const { error } = await author.rpc("unlink_thread", { thread: threadId, placement: 3 });
    expect(error).toBeNull();

    const versionRow = await threadVersionRow(threadId);
    expect(versionRow).toEqual({ status: "unlinked", text_position: null, thread_position: 3 });

    const textRow = await threadTextRow(threadId);
    expect(textRow).toEqual({ selected_text: null, paragraph_text: null });
  });

  it("lets a Reviewer with access unlink a Thread just as the Author can", async () => {
    const threadId = await startThread(reviewer);

    const { error } = await reviewer.rpc("unlink_thread", { thread: threadId, placement: 1 });
    expect(error).toBeNull();

    const versionRow = await threadVersionRow(threadId);
    expect(versionRow?.status).toBe("unlinked");
  });

  it("has no direct update path onto threads' matching text at all", async () => {
    // Discarding text is only ever safe alongside the same statement flipping
    // thread_versions.status — `threads` grants no update to authenticated for these
    // columns, the same reasoning resolve_thread gives for resolved_version_number, so
    // a caller reaching this table directly (rather than through unlink_thread) is
    // refused outright rather than left able to null the text with nothing else
    // changing.
    const threadId = await startThread(author);

    const { error } = await author
      .from("threads")
      .update({ selected_text: null, paragraph_text: null })
      .eq("id", threadId);
    expect(error).not.toBeNull();

    const textRow = await threadTextRow(threadId);
    expect(textRow?.selected_text).not.toBeNull();
  });

  it("keeps an already-Unlinked Thread's matching text when only its placement moves", async () => {
    const threadId = await startThread(author);
    markUnlinkedBySuperuser(threadId, 5);
    const beforeText = await threadTextRow(threadId);
    expect(beforeText?.selected_text).not.toBeNull();

    const { error } = await author.rpc("unlink_thread", { thread: threadId, placement: 12 });
    expect(error).toBeNull();

    const versionRow = await threadVersionRow(threadId);
    expect(versionRow).toEqual({ status: "unlinked", text_position: null, thread_position: 12 });

    const afterText = await threadTextRow(threadId);
    expect(afterText).toEqual(beforeText);
  });

  it("raises for a stranger to the Book", async () => {
    const threadId = await startThread(author);

    const { error } = await stranger.rpc("unlink_thread", { thread: threadId, placement: 0 });
    expect(error).not.toBeNull();
  });

  it("refuses anon calling unlink_thread outright", async () => {
    const { error } = await anonClient().rpc("unlink_thread", {
      thread: crypto.randomUUID(),
      placement: 0,
    });
    expect(error).not.toBeNull();
  });
});

describe("link, move and unlink happen on the latest Version only", () => {
  it("refuses a link/move update against a superseded Version's row", async () => {
    const bookId = createOneVersionBook();
    const threadId = await startThread(author, bookId);

    // Supersede it — v1's row is no longer the latest Version's, the same
    // enforce_version_numbering shape tests/resolve-thread-policies.test.ts uses.
    asSuperuser(`update public.books set latest_version_number = 2 where id = '${bookId}';
      insert into public.versions (book_id, version_number, hash)
      values ('${bookId}', 2, 'link-test-${bookId}-v2');`);

    const { error } = await author
      .from("thread_versions")
      .update({ status: "unlinked", text_position: null, thread_position: 0 })
      .eq("thread_id", threadId)
      .eq("book_id", bookId)
      .eq("version_number", 1);
    expect(error).not.toBeNull();

    // Untouched: the trigger fired before any column was written.
    const row = await threadVersionRow(threadId);
    expect(row?.status).toBe("linked");
  });

  it("refuses unlink_thread when the Thread has no row on the Book's actual latest Version", async () => {
    const bookId = createOneVersionBook();
    const threadId = await startThread(author, bookId);

    // Bumped with no corresponding thread_versions row for this Thread — never
    // carried onto v2 — so unlink_thread, which always targets the Book's own latest,
    // finds nothing to act on.
    asSuperuser(`update public.books set latest_version_number = 2 where id = '${bookId}';
      insert into public.versions (book_id, version_number, hash)
      values ('${bookId}', 2, 'link-test-${bookId}-v2');`);

    const { error } = await author.rpc("unlink_thread", { thread: threadId, placement: 0 });
    expect(error).not.toBeNull();
  });
});
