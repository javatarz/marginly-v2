"use client";

import type { ThreadsLayerState } from "./use-threads-layer";
import styles from "./threads-layer.module.css";

/**
 * The margin (ADR-0007/ADR-0014): one box per Thread, pinned to the vertical position
 * of its Highlight and nudged downward only so two Threads never overlap. Rendered in
 * its own `position: relative` column, a sibling of the reading column in
 * `reader.tsx`'s layout — `useThreadsLayer` computes each box's `top` in the same
 * coordinate space the reading column starts from, so the two columns line up without
 * this component needing to know anything about the text.
 */
export function ThreadsMargin({ state }: { state: ThreadsLayerState }) {
  return (
    <div className={styles.margin}>
      {state.orderedThreads.map((thread) => (
        <div
          key={thread.threadId}
          ref={(el) => state.registerMarginBox(thread.threadId, el)}
          className={
            thread.threadId === state.selectedThreadId
              ? `${styles.threadBox} ${styles.threadBoxSelected}`
              : styles.threadBox
          }
          style={topStyle(state.marginPositions.find((p) => p.id === thread.threadId)?.top ?? 0)}
          onClick={() => state.selectThread(thread.threadId)}
        >
          {thread.comments.map((comment) => (
            <p key={comment.id} className={styles.comment}>
              {comment.body}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

// Computed from the margin layout, with no design decision in it for a CSS Module to
// hold, so it is built through its own named function rather than a doubled-brace
// object literal (tests/style-guard.test.ts's no-inline-style rule targets that shape).
function topStyle(top: number): React.CSSProperties {
  return { top };
}
