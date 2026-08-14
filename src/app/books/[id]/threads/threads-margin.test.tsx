// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThreadsMargin } from "./threads-margin";
import type { ThreadsLayerState } from "./use-threads-layer";
import type { ThreadData } from "./threads-api";

afterEach(cleanup);

const AUTHOR_ID = "author-1";
const READER_ID = "reader-1";

function linkedThread(): ThreadData {
  return {
    threadId: "thread-linked",
    createdBy: AUTHOR_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "linked",
    range: [0, 5],
    threadPosition: null,
    resolved: false,
    comments: [
      { id: "comment-1", authorId: AUTHOR_ID, body: "still attached to its passage", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  };
}

function unlinkedThread(): ThreadData {
  return {
    threadId: "thread-unlinked",
    createdBy: AUTHOR_ID,
    createdAt: "2026-01-02T00:00:00.000Z",
    status: "unlinked",
    range: null,
    threadPosition: 42,
    resolved: false,
    comments: [
      { id: "comment-2", authorId: AUTHOR_ID, body: "the passage this was rooted on is gone", createdAt: "2026-01-02T00:00:00.000Z" },
    ],
  };
}

/**
 * A minimal `ThreadsLayerState` fixture — enough for `ThreadsMargin` to render, without
 * going through `useThreadsLayer`'s own DOM-measuring machinery (`threads-overlay.test.tsx`
 * already covers that hook's selection behaviour; this component only needs a state
 * shape to render from).
 */
function stateWith(threads: readonly ThreadData[]): ThreadsLayerState {
  return {
    orderedThreads: threads,
    selectedThreadId: null,
    selectThread: () => {},
    unionRects: [],
    selectedRects: [],
    marginPositions: threads.map((t, i) => ({ id: t.threadId, top: i * 100 })),
    registerMarginBox: () => {},
    pendingSelection: null,
    composerOpen: false,
    openComposer: () => {},
    composerBody: "",
    setComposerBody: () => {},
    submitError: null,
    submitting: false,
    cancelComposer: () => {},
    submitComment: () => {},
    isLatest: false,
    replyBody: "",
    setReplyBody: () => {},
    replyError: null,
    replySubmitting: false,
    submitReply: () => {},
    editingCommentId: null,
    editingBody: "",
    setEditingBody: () => {},
    editError: null,
    editSubmitting: false,
    startEditingComment: () => {},
    cancelEditingComment: () => {},
    submitEditComment: () => {},
    deletingCommentId: null,
    deleteErrorCommentId: null,
    deleteError: null,
    removeComment: () => {},
    resolveNote: "",
    setResolveNote: () => {},
    resolveSubmitting: false,
    resolveError: null,
    submitResolve: () => {},
  };
}

describe("ThreadsMargin: an Unlinked Thread's frozen state (#34)", () => {
  it("marks an Unlinked Thread's box as Unlinked", () => {
    render(
      <ThreadsMargin
        state={stateWith([unlinkedThread()])}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    expect(screen.getByText("Unlinked")).toBeInTheDocument();
    expect(
      screen.getByText("the passage this was rooted on is gone"),
    ).toBeInTheDocument();
  });

  it("does not mark a Linked Thread's box as Unlinked", () => {
    render(
      <ThreadsMargin
        state={stateWith([linkedThread()])}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    expect(screen.queryByText("Unlinked")).not.toBeInTheDocument();
  });

  it("offers no reply composer on a Version that is no longer latest, Linked or Unlinked alike", () => {
    render(
      <ThreadsMargin
        state={stateWith([linkedThread(), unlinkedThread()])}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    expect(screen.queryByPlaceholderText("Reply…")).not.toBeInTheDocument();
  });
});
