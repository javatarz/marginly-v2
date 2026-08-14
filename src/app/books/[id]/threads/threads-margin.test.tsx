// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    rootedText: "the passage this Thread is on",
    resolved: false,
    comments: [
      {
        id: "comment-1",
        authorId: AUTHOR_ID,
        authorEmail: "annie@gmail.com",
        body: "still attached to its passage",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function unlinkedThread(rootedText: string | null = "the passage this was rooted on"): ThreadData {
  return {
    threadId: "thread-unlinked",
    createdBy: AUTHOR_ID,
    createdAt: "2026-01-02T00:00:00.000Z",
    status: "unlinked",
    range: null,
    threadPosition: 42,
    rootedText,
    resolved: false,
    comments: [
      {
        id: "comment-2",
        authorId: AUTHOR_ID,
        authorEmail: "annie@gmail.com",
        body: "the passage this was rooted on is gone",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  };
}

/**
 * A minimal `ThreadsLayerState` fixture — enough for `ThreadsMargin` to render, without
 * going through `useThreadsLayer`'s own DOM-measuring machinery (`threads-overlay.test.tsx`
 * already covers that hook's selection behaviour; this component only needs a state
 * shape to render from).
 */
function stateWith(
  threads: readonly ThreadData[],
  overrides: Partial<ThreadsLayerState> = {},
): ThreadsLayerState {
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
    draggingThreadId: null,
    beginThreadDrag: () => {},
    linkError: null,
    ...overrides,
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
    expect(screen.getByText("Annie")).toBeInTheDocument();
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

describe("ThreadsMargin: link, move and unlink (#35)", () => {
  it("shows the text an Unlinked Thread was rooted on", () => {
    render(
      <ThreadsMargin
        state={stateWith([unlinkedThread()])}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    expect(screen.getByText("“the passage this was rooted on”")).toBeInTheDocument();
  });

  it("shows no rooted text for a deliberately Unlinked Thread that has discarded it", () => {
    render(
      <ThreadsMargin
        state={stateWith([unlinkedThread(null)])}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    expect(screen.queryByText("“the passage this was rooted on”")).not.toBeInTheDocument();
  });

  it("offers a drag handle on the latest Version", () => {
    render(
      <ThreadsMargin
        state={stateWith([linkedThread()], { isLatest: true })}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    expect(screen.getByTitle(/drag onto text/i)).toBeInTheDocument();
  });

  it("offers no drag handle on a Version that is no longer latest", () => {
    render(
      <ThreadsMargin
        state={stateWith([linkedThread()], { isLatest: false })}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    expect(screen.queryByTitle(/drag onto text/i)).not.toBeInTheDocument();
  });

  it("starts a drag from the handle without toggling the Thread's own selection", () => {
    const beginThreadDrag = vi.fn();
    const selectThread = vi.fn();

    render(
      <ThreadsMargin
        state={stateWith([linkedThread()], { isLatest: true, beginThreadDrag, selectThread })}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    fireEvent.mouseDown(screen.getByTitle(/drag onto text/i));

    expect(beginThreadDrag).toHaveBeenCalledWith("thread-linked", expect.anything());
    expect(selectThread).not.toHaveBeenCalled();
  });

  it("does not toggle selection on a plain click on the handle (mousedown + click, no drag)", () => {
    const selectThread = vi.fn();

    render(
      <ThreadsMargin
        state={stateWith([linkedThread()], { isLatest: true, selectThread })}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    const handle = screen.getByTitle(/drag onto text/i);
    // A real click is a mousedown followed by a click event at the same target —
    // mousedown's own stopPropagation stops only the mousedown; the click that
    // follows must be stopped too, or it bubbles to the box's own onClick.
    fireEvent.mouseDown(handle);
    fireEvent.click(handle);

    expect(selectThread).not.toHaveBeenCalled();
  });

  it("shows a link/unlink error", () => {
    render(
      <ThreadsMargin
        state={stateWith([linkedThread()], { linkError: "Could not place the Thread there." })}
        bookAuthorId={AUTHOR_ID}
        currentUserId={READER_ID}
      />,
    );

    expect(screen.getByText("Could not place the Thread there.")).toBeInTheDocument();
  });
});
