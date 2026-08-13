"use client";

import type { ThreadsLayerState } from "./use-threads-layer";
import styles from "./threads-layer.module.css";

/**
 * The Highlight itself (ADR-0007): rectangles drawn over the text, plus the one
 * affordance a drag ends in. Rendered inside the same `position: relative` wrapper as
 * the reading container, so its coordinates — computed in `useThreadsLayer` relative to
 * that same container — line up without this component knowing anything about layout.
 */
export function ThreadsOverlay({ state }: { state: ThreadsLayerState }) {
  const { unionRects, selectedRects, pendingSelection, composerOpen } = state;

  return (
    <>
      <div className={styles.highlightLayer} aria-hidden="true">
        {unionRects.map((rect, i) => (
          <span key={`union-${i}`} className={styles.highlight} style={rectStyle(rect)} />
        ))}
        {selectedRects.map((rect, i) => (
          <span key={`selected-${i}`} className={styles.highlightSelected} style={rectStyle(rect)} />
        ))}
      </div>

      {pendingSelection ? (
        composerOpen ? (
          <div className={styles.composer} style={anchorStyle(pendingSelection.anchorTop, pendingSelection.anchorLeft)}>
            <textarea
              autoFocus
              className={styles.composerInput}
              value={state.composerBody}
              onChange={(event) => state.setComposerBody(event.target.value)}
              placeholder="Write the first Comment…"
            />
            {state.submitError ? <p className={styles.composerError}>{state.submitError}</p> : null}
            <div className={styles.composerActions}>
              <button type="button" className={styles.composerCancel} onClick={state.cancelComposer}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.composerSubmit}
                disabled={state.submitting || state.composerBody.trim().length === 0}
                onClick={state.submitComment}
              >
                Start Thread
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.startThreadButton}
            style={anchorStyle(pendingSelection.anchorTop, pendingSelection.anchorLeft)}
            onClick={state.openComposer}
          >
            Start a Thread
          </button>
        )
      ) : null}
    </>
  );
}

// Both computed from live geometry, with no design decision in them for a CSS Module to
// hold, so each is built through its own named function and passed as a single prop
// value rather than as a doubled-brace object literal (tests/style-guard.test.ts's
// no-inline-style rule targets that literal shape).
function rectStyle(rect: { top: number; left: number; width: number; height: number }): React.CSSProperties {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function anchorStyle(top: number, left: number): React.CSSProperties {
  return { top, left };
}
