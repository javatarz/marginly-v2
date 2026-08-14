import { beforeAll, describe, expect, it } from "vitest";

import { anonClient, asSuperuser, signedInClient } from "./support/local-stack";

/**
 * Resolving a Thread (#31), against a real database — ADR-0002/0003/0006/0010.
 *
 * `resolve_thread` is `security definer`, so a Reviewer's refusal below is the
 * function raising by hand, not an ordinary policy matching zero rows — ADR-0010's
 * whole reason for choosing a function over a policy here. Everything else (the
 * immutability of `resolved_version_number` once set, the latest-Version timing) is a
 * trigger, exercised directly through `asSuperuser` the way no signed-in client ever
 * could, since `threads` grants no `update` to `authenticated` at all.
 */
const AUTHOR = "resolve-author@example.com";
const REVIEWER = "resolve-reviewer@example.com";
const STRANGER = "resolve-stranger@example.com";

const READY_BOOK = "11111111-0000-4000-8000-000000000001";
const TWO_VERSION_BOOK = "11111111-0000-4000-8000-000000000002";

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

  // Idempotent, the same shape tests/threads-policies.test.ts uses: a Version is
  // immutable, so these Books and their Versions are upserted rather than deleted and
  // recreated; only the Threads under them accumulate across runs.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${READY_BOOK}', u.id, 'Ready for Resolve', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name,
      latest_version_number = 1;

    insert into public.versions (book_id, version_number, hash)
    select '${READY_BOOK}', 1, 'resolve-test-ready-v1'
    where not exists (
      select 1 from public.versions where book_id = '${READY_BOOK}' and version_number = 1
    );

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${READY_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;

    -- enforce_version_numbering requires a Version's own number to equal
    -- latest_version_number at the moment it is inserted, so seeding two Version rows
    -- means bumping the counter between them rather than setting it to 2 up front.
    insert into public.books (id, author_id, name, latest_version_number)
    select '${TWO_VERSION_BOOK}', u.id, 'Two Versions for Resolve', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name,
      latest_version_number = 1;

    insert into public.versions (book_id, version_number, hash)
    select '${TWO_VERSION_BOOK}', 1, 'resolve-test-two-v1'
    where not exists (
      select 1 from public.versions where book_id = '${TWO_VERSION_BOOK}' and version_number = 1
    );

    update public.books set latest_version_number = 2 where id = '${TWO_VERSION_BOOK}';

    insert into public.versions (book_id, version_number, hash)
    select '${TWO_VERSION_BOOK}', 2, 'resolve-test-two-v2'
    where not exists (
      select 1 from public.versions where book_id = '${TWO_VERSION_BOOK}' and version_number = 2
    );

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${TWO_VERSION_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;
  `);
}, 120_000);

async function startThread(client: Client, body: string, book = READY_BOOK): Promise<string> {
  const { data: threadId, error } = await client.rpc("start_thread", {
    book,
    range_start: 0,
    range_end: 5,
    selected_text: "hello",
    paragraph_text: "hello world",
    body,
  });
  expect(error).toBeNull();
  return threadId!;
}

describe("resolving a Thread", () => {
  it("lets the Author Resolve a Thread with a final note", async () => {
    const threadId = await startThread(author, "an Author's own Thread to Resolve");

    const { error } = await author.rpc("resolve_thread", {
      thread: threadId,
      note: "resolved — thanks!",
    });
    expect(error).toBeNull();

    const { data: thread } = await author
      .from("threads")
      .select("resolved_version_number")
      .eq("id", threadId)
      .single();
    expect(thread?.resolved_version_number).toBe(1);

    const { data: comments } = await author
      .from("comments")
      .select("body")
      .eq("thread_id", threadId)
      .order("created_at");
    expect(comments).toEqual([
      { body: "an Author's own Thread to Resolve" },
      { body: "resolved — thanks!" },
    ]);
  });

  it("lets the Author Resolve with no final note", async () => {
    const threadId = await startThread(author, "no note on this one");

    const { error } = await author.rpc("resolve_thread", { thread: threadId });
    expect(error).toBeNull();

    const { data: comments } = await author.from("comments").select("body").eq("thread_id", threadId);
    expect(comments).toHaveLength(1);
  });

  it("raises when a Reviewer attempts to Resolve", async () => {
    const threadId = await startThread(reviewer, "started by a Reviewer");

    const { error } = await reviewer.rpc("resolve_thread", { thread: threadId });
    expect(error).not.toBeNull();

    const { data: thread } = await author
      .from("threads")
      .select("resolved_version_number")
      .eq("id", threadId)
      .single();
    expect(thread?.resolved_version_number).toBeNull();
  });

  it("raises when a stranger to the Book attempts to Resolve", async () => {
    const threadId = await startThread(author, "not open to strangers");

    const { error } = await stranger.rpc("resolve_thread", { thread: threadId });
    expect(error).not.toBeNull();
  });

  it("refuses anon calling resolve_thread outright", async () => {
    const { error } = await anonClient().rpc("resolve_thread", { thread: crypto.randomUUID() });
    expect(error).not.toBeNull();
  });

  it("refuses Resolving the same Thread twice", async () => {
    const threadId = await startThread(author, "resolved only once");

    const first = await author.rpc("resolve_thread", { thread: threadId });
    expect(first.error).toBeNull();

    const second = await author.rpc("resolve_thread", { thread: threadId });
    expect(second.error).not.toBeNull();
  });

  it("resolves onto the Book's latest Version, not the Thread's created Version", async () => {
    const threadId = await startThread(author, "on the second Version", TWO_VERSION_BOOK);

    const { error } = await author.rpc("resolve_thread", { thread: threadId });
    expect(error).toBeNull();

    const { data: thread } = await author
      .from("threads")
      .select("resolved_version_number")
      .eq("id", threadId)
      .single();
    expect(thread?.resolved_version_number).toBe(2);
  });
});

describe("a Resolved Thread is immutable", () => {
  it("refuses a further Comment once the Thread is Resolved", async () => {
    const threadId = await startThread(author, "resolved, then replied to");

    const resolve = await author.rpc("resolve_thread", { thread: threadId });
    expect(resolve.error).toBeNull();

    const { error } = await author.rpc("add_comment", { thread: threadId, body: "too late" });
    expect(error).not.toBeNull();
  });
});

describe("a resolution cannot be cleared or moved", () => {
  it("refuses clearing resolved_version_number back to null", async () => {
    const threadId = await startThread(author, "resolved, then attacked");
    const resolve = await author.rpc("resolve_thread", { thread: threadId });
    expect(resolve.error).toBeNull();

    expect(() =>
      asSuperuser(`update public.threads set resolved_version_number = null where id = '${threadId}';`),
    ).toThrow();
  });

  it("refuses moving resolved_version_number to a different Version", async () => {
    const threadId = await startThread(author, "resolved, then moved");
    const resolve = await author.rpc("resolve_thread", { thread: threadId });
    expect(resolve.error).toBeNull();

    // The immutability check fires on any change to an already-set resolution, before
    // it ever asks whether the new value names a real Version — so no second Version
    // needs to exist here, and this leaves READY_BOOK's own latest untouched for every
    // other test in this file.
    expect(() =>
      asSuperuser(`update public.threads set resolved_version_number = 999 where id = '${threadId}';`),
    ).toThrow();
  });
});

describe("version_threads reflects Resolved state", () => {
  it("reads a Resolved Thread as resolved on the Version it was Resolved on", async () => {
    const threadId = await startThread(reviewer, "reads back resolved");
    const resolve = await author.rpc("resolve_thread", { thread: threadId });
    expect(resolve.error).toBeNull();

    const { data, error } = await author.rpc("version_threads", { book: READY_BOOK, version_number: 1 });
    expect(error).toBeNull();

    const row = data?.find((t) => t.thread_id === threadId);
    expect(row?.resolved).toBe(true);
  });

  it("reads an Open Thread as not resolved", async () => {
    const threadId = await startThread(reviewer, "reads back open");

    const { data, error } = await author.rpc("version_threads", { book: READY_BOOK, version_number: 1 });
    expect(error).toBeNull();

    const row = data?.find((t) => t.thread_id === threadId);
    expect(row?.resolved).toBe(false);
  });
});

describe("no Reviewer path can reach threads.resolved_version_number", () => {
  it("has no update grant on threads at all", async () => {
    const threadId = await startThread(author, "no direct update path");

    const { error } = await author.from("threads").update({ resolved_version_number: 1 }).eq("id", threadId);
    expect(error).not.toBeNull();
  });
});
