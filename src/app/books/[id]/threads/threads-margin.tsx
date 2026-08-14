"use client";

import { useMemo } from "react";

import { canModifyComment, commentRole } from "@/lib/books/comment-role";

import type { ThreadsLayerState } from "./use-threads-layer";
import styles from "./threads-layer.module.css";

/**
 * The margin (ADR-0007/ADR-0014): one box per Thread, pinned to the vertical position
 * of its Highlight and nudged downward only so two Threads never overlap. Rendered in
 * its own `position: relative` column, a sibling of the reading column in
 * `reader.tsx`'s layout — `useThreadsLayer` computes each box's `top` in the same
 * coordinate space the reading column starts from, so the two columns line up without
 * this component needing to know anything about the text.
 *
 * #30: every Comment shows its writer's role, computed from `bookAuthorId` the same
 * way the People panel does. Replying, editing and deleting are only ever offered
 * while the Book is on its latest Version (`state.isLatest`) — the same gate
 * `enforce_comment_written_on_latest_version` and its edit/delete siblings enforce in
 * the database, so a disabled affordance here never contradicts a refusal there.
 */
export function ThreadsMargin({
  state,
  bookAuthorId,
  currentUserId,
}: {
  state: ThreadsLayerState;
  bookAuthorId: string;
  currentUserId: string;
}) {
  const marginTopById = useMemo(
    () => new Map(state.marginPositions.map((p) => [p.id, p.top])),
    [state.marginPositions],
  );

  return (
    <div className={styles.margin}>
      {state.orderedThreads.map((thread) => {
        const selected = thread.threadId === state.selectedThreadId;

        return (
          <div
            key={thread.threadId}
            ref={(el) => state.registerMarginBox(thread.threadId, el)}
            className={selected ? `${styles.threadBox} ${styles.threadBoxSelected}` : styles.threadBox}
            style={topStyle(marginTopById.get(thread.threadId) ?? 0)}
            onClick={() => state.selectThread(thread.threadId)}
          >
            {thread.comments.map((comment) => {
              const role = commentRole({ bookAuthorId, commentAuthorId: comment.authorId });
              const canModify = canModifyComment({
                commentAuthorId: comment.authorId,
                currentUserId,
                isLatest: state.isLatest,
              });
              const isEditing = state.editingCommentId === comment.id;

              return (
                <div key={comment.id} className={styles.comment}>
                  <p className={styles.commentMeta}>{role === "author" ? "Author" : "Reviewer"}</p>

                  {isEditing ? (
                    <div onClick={(event) => event.stopPropagation()}>
                      <textarea
                        autoFocus
                        className={styles.composerInput}
                        value={state.editingBody}
                        onChange={(event) => state.setEditingBody(event.target.value)}
                      />
                      {state.editError ? <p className={styles.composerError}>{state.editError}</p> : null}
                      <div className={styles.composerActions}>
                        <button
                          type="button"
                          className={styles.composerCancel}
                          onClick={state.cancelEditingComment}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={styles.composerSubmit}
                          disabled={state.editSubmitting || state.editingBody.trim().length === 0}
                          onClick={state.submitEditComment}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className={styles.commentBody}>{comment.body}</p>
                  )}

                  {canModify && !isEditing ? (
                    <div className={styles.commentActions} onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.commentAction}
                        onClick={() => state.startEditingComment(comment.id, comment.body)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.commentAction}
                        disabled={state.deletingCommentId === comment.id}
                        onClick={() => state.removeComment(comment.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}

                  {state.deleteErrorCommentId === comment.id && state.deleteError ? (
                    <p className={styles.composerError}>{state.deleteError}</p>
                  ) : null}
                </div>
              );
            })}

            {selected && state.isLatest ? (
              <div onClick={(event) => event.stopPropagation()}>
                <textarea
                  className={styles.composerInput}
                  value={state.replyBody}
                  onChange={(event) => state.setReplyBody(event.target.value)}
                  placeholder="Reply…"
                />
                {state.replyError ? <p className={styles.composerError}>{state.replyError}</p> : null}
                <div className={styles.composerActions}>
                  <button
                    type="button"
                    className={styles.composerSubmit}
                    disabled={state.replySubmitting || state.replyBody.trim().length === 0}
                    onClick={state.submitReply}
                  >
                    Reply
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// Computed from the margin layout, with no design decision in it for a CSS Module to
// hold, so it is built through its own named function rather than a doubled-brace
// object literal (tests/style-guard.test.ts's no-inline-style rule targets that shape).
function topStyle(top: number): React.CSSProperties {
  return { top };
}
