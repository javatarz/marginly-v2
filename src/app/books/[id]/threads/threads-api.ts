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
    range: parseTextPosition(row.text_position),
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
