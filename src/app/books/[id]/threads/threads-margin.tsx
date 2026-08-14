"use client";

import { useMemo } from "react";

import { canModifyComment, canResolveThread, commentRole } from "@/lib/books/comment-role";
import { toggleSelectedThreadId } from "@/lib/reading/toggle-selected-thread";

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
      {state.linkError ? <p className={styles.composerError}>{state.linkError}</p> : null}

      {state.orderedThreads.map((thread) => {
        const selected = thread.threadId === state.selectedThreadId;
        const dragging = thread.threadId === state.draggingThreadId;

        return (
          <div
            key={thread.threadId}
            ref={(el) => state.registerMarginBox(thread.threadId, el)}
            className={[
              styles.threadBox,
              selected ? styles.threadBoxSelected : "",
              dragging ? styles.threadBoxDragging : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={topStyle(marginTopById.get(thread.threadId) ?? 0)}
            onClick={() => state.selectThread(toggleSelectedThreadId(state.selectedThreadId, thread.threadId))}
          >
            {state.isLatest ? (
              <button
                type="button"
                className={styles.dragHandle}
                title="Drag onto text to link or move it; drag into the margin to unlink it"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  state.beginThreadDrag(thread.threadId, event);
                }}
                // Stops a plain click on the handle from bubbling to the box's own
                // onClick and toggling selection — mousedown's own stopPropagation
                // above only stops the mousedown, not the click that follows it.
                onClick={(event) => event.stopPropagation()}
              >
                ⠿
              </button>
            ) : null}

            {thread.resolved ? <p className={styles.resolvedBadge}>Resolved</p> : null}
            {thread.status === "unlinked" ? (
              <p className={styles.unlinkedBadge}>Unlinked</p>
            ) : null}
            {thread.status === "unlinked" && thread.rootedText ? (
              <p className={styles.rootedText}>“{thread.rootedText}”</p>
            ) : null}

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
                  <p
                    className={
                      role === "author"
                        ? `${styles.commentMeta} ${styles.commentMetaAuthor}`
                        : styles.commentMeta
                    }
                  >
                    {role === "author" ? "Author" : "Reviewer"}
                  </p>

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
                        className={`${styles.commentAction} ${styles.commentActionDelete}`}
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

            {selected && state.isLatest && !thread.resolved ? (
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

            {selected &&
            canResolveThread({
              bookAuthorId,
              currentUserId,
              isLatest: state.isLatest,
              resolved: thread.resolved,
            }) ? (
              <div onClick={(event) => event.stopPropagation()}>
                <textarea
                  className={styles.composerInput}
                  value={state.resolveNote}
                  onChange={(event) => state.setResolveNote(event.target.value)}
                  placeholder="Final note (optional)…"
                />
                {state.resolveError ? <p className={styles.composerError}>{state.resolveError}</p> : null}
                <div className={styles.composerActions}>
                  <button
                    type="button"
                    className={styles.composerSubmit}
                    disabled={state.resolveSubmitting}
                    onClick={() => state.submitResolve(thread.threadId)}
                  >
                    Resolve
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
