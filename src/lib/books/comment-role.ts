/**
 * A Comment's writer is never a stored role (ADR-0010): the Author is whoever matches
 * the Book's own `author_id`, and anyone else is a Reviewer — the same comparison
 * `people-list.ts` makes for the People panel, here for one Comment at a time.
 */
export function commentRole({
  bookAuthorId,
  commentAuthorId,
}: {
  bookAuthorId: string;
  commentAuthorId: string;
}): "author" | "reviewer" {
  return commentAuthorId === bookAuthorId ? "author" : "reviewer";
}

/**
 * Whether to offer Edit/Delete for a Comment (#30): the database refuses either once
 * the Comment is not the caller's own or its Version is no longer latest
 * (`enforce_comment_edited_on_latest_version`/`enforce_comment_deleted_on_latest_version`),
 * so this mirrors that same pair of conditions to decide whether the affordance is
 * worth showing at all — offering a control the server would refuse is its own bug.
 */
export function canModifyComment({
  commentAuthorId,
  currentUserId,
  isLatest,
}: {
  commentAuthorId: string;
  currentUserId: string;
  isLatest: boolean;
}): boolean {
  return commentAuthorId === currentUserId && isLatest;
}

/**
 * Whether to offer Resolve for a Thread (#31): only the Author, only on the latest
 * Version, and only while the Thread is still Open — `resolve_thread` refuses all
 * three by hand (a Reviewer's attempt raises; `enforce_thread_resolved_once_and_on_latest`
 * refuses a second resolution), so this mirrors that same set of conditions.
 */
export function canResolveThread({
  bookAuthorId,
  currentUserId,
  isLatest,
  resolved,
}: {
  bookAuthorId: string;
  currentUserId: string;
  isLatest: boolean;
  resolved: boolean;
}): boolean {
  return currentUserId === bookAuthorId && isLatest && !resolved;
}
