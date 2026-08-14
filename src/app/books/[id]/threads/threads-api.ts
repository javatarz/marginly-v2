import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { parseTextPosition } from "@/lib/reading/thread-range";

export type ThreadComment = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
};

/** The shape `version_threads`' `jsonb_build_object` actually emits, snake_case. */
type RawComment = { id: string; author_id: string; body: string; created_at: string };

export type ThreadData = {
  threadId: string;
  createdBy: string;
  createdAt: string;
  range: readonly [number, number];
  resolved: boolean;
  comments: readonly ThreadComment[];
};

/**
 * The thin read side of `version_threads` (ADR-0006's shared read, this ticket's
 * narrowed shape — see the migration). No unit test: this is wiring over a Supabase
 * client, covered by tests/threads-policies.test.ts against the real function.
 */
export async function fetchVersionThreads(
  supabase: SupabaseClient<Database>,
  bookId: string,
  versionNumber: number,
): Promise<ThreadData[]> {
  const { data, error } = await supabase.rpc("version_threads", {
    book: bookId,
    version_number: versionNumber,
  });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    threadId: row.thread_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    range: parseTextPosition(row.text_position as string),
    resolved: row.resolved,
    comments: ((row.comments as RawComment[] | null) ?? []).map((comment) => ({
      id: comment.id,
      authorId: comment.author_id,
      body: comment.body,
      createdAt: comment.created_at,
    })),
  }));
}

/**
 * The one write path (`start_thread`, this ticket's migration): a Thread, its first
 * per-Version row and its first Comment, in one call. No unit test — thin wiring over
 * `security invoker` RLS and triggers, covered by tests/threads-policies.test.ts.
 */
export async function startThread(
  supabase: SupabaseClient<Database>,
  args: {
    bookId: string;
    start: number;
    end: number;
    selectedText: string;
    paragraphText: string;
    body: string;
  },
): Promise<{ threadId: string } | { error: string }> {
  const { data, error } = await supabase.rpc("start_thread", {
    book: args.bookId,
    range_start: args.start,
    range_end: args.end,
    selected_text: args.selectedText,
    paragraph_text: args.paragraphText,
    body: args.body,
  });

  if (error || !data) {
    return { error: error?.message ?? "Could not start the Thread." };
  }

  return { threadId: data };
}

/**
 * Adding a Comment to a Thread that already exists (#30, `add_comment`). No unit
 * test — thin wiring over `security invoker` RLS and triggers, covered by
 * tests/comments-policies.test.ts.
 */
export async function addComment(
  supabase: SupabaseClient<Database>,
  args: { threadId: string; body: string },
): Promise<{ commentId: string } | { error: string }> {
  const { data, error } = await supabase.rpc("add_comment", {
    thread: args.threadId,
    body: args.body,
  });

  if (error || !data) {
    return { error: error?.message ?? "Could not add the Comment." };
  }

  return { commentId: data };
}

/**
 * Resolving a Thread (#31, `resolve_thread`), optionally leaving a final note as a
 * Comment. No unit test — thin wiring over a `security definer` function, covered by
 * tests/resolve-thread-policies.test.ts.
 */
export async function resolveThread(
  supabase: SupabaseClient<Database>,
  args: { threadId: string; note: string | null },
): Promise<{ error: string } | undefined> {
  const { error } = await supabase.rpc("resolve_thread", {
    thread: args.threadId,
    note: args.note ?? undefined,
  });

  if (error) {
    return { error: error.message };
  }

  return undefined;
}

/**
 * Editing a Comment's own body (#30) — a plain column-scoped update, gated entirely by
 * the migration's RLS policy and its latest-Version trigger. No unit test — thin
 * wiring, covered by tests/comments-policies.test.ts.
 */
export async function editComment(
  supabase: SupabaseClient<Database>,
  args: { commentId: string; body: string },
): Promise<{ error: string } | undefined> {
  const { error } = await supabase.from("comments").update({ body: args.body }).eq("id", args.commentId);

  if (error) {
    return { error: error.message };
  }

  return undefined;
}

/**
 * Hard-deleting a Comment (#30) — gated by RLS and the latest-Version trigger; deleting
 * the last Comment in a Thread cascades to the Thread itself, entirely in the
 * database. No unit test — thin wiring, covered by tests/comments-policies.test.ts.
 */
export async function deleteComment(
  supabase: SupabaseClient<Database>,
  args: { commentId: string },
): Promise<{ error: string } | undefined> {
  const { error } = await supabase.from("comments").delete().eq("id", args.commentId);

  if (error) {
    return { error: error.message };
  }

  return undefined;
}
