// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThreadsMargin } from "./threads-margin";
import { ThreadsOverlay } from "./threads-overlay";
import { useThreadsLayer } from "./use-threads-layer";
import { fetchVersionThreads, linkThread, unlinkThread } from "./threads-api";
import type { ThreadData } from "./threads-api";

// Boundary mocks (CODING_STANDARDS.md §3): the Supabase client and the threads-api I/O
// adapter, never useThreadsLayer's own drag-and-drop logic.
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({}),
}));
vi.mock("./threads-api", () => ({
  fetchVersionThreads: vi.fn(),
  startThread: vi.fn(),
  linkThread: vi.fn().mockResolvedValue(undefined),
  unlinkThread: vi.fn().mockResolvedValue(undefined),
}));

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const FAKE_RECT = { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 } as DOMRect;
Range.prototype.getClientRects = () => [FAKE_RECT] as unknown as DOMRectList;

// jsdom lays nothing out, so every element reports the same origin-sized box — enough
// for the "did the drop land over the text column" check the drag handler makes, which
// only ever compares a drop point against this rect.
const CONTAINER_RECT = { top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500 } as DOMRect;
HTMLElement.prototype.getBoundingClientRect = () => CONTAINER_RECT;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
});

const PARAGRAPH_TEXT = "Hello world. Second sentence here.";
const THREAD: ThreadData = {
  threadId: "thread-1",
  createdBy: "author-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "linked",
  range: [0, 5],
  threadPosition: null,
  rootedText: null,
  resolved: false,
  comments: [
    {
      id: "c1",
      authorId: "author-1",
      authorEmail: "author@example.com",
      body: "hi",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

function Harness() {
  const contentRef = useRef<HTMLDivElement>(null);
  const state = useThreadsLayer({ bookId: "book-1", versionNumber: 1, isLatest: true, contentRef });
  return (
    <div>
      <div ref={contentRef}>
        <p>{PARAGRAPH_TEXT}</p>
        <ThreadsOverlay state={state} />
      </div>
      <ThreadsMargin state={state} bookAuthorId="author-1" currentUserId="author-1" />
    </div>
  );
}

async function renderSettled(): Promise<void> {
  render(<Harness />);
  await waitFor(() => expect(fetchVersionThreads).toHaveBeenCalled());
  await act(async () => {});
}

function selectRange(paragraph: HTMLElement, start: number, end: number): void {
  const textNode = paragraph.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** Stubs the browser's own hit-test so `domPositionAt` resolves to a fixed offset in
 * the paragraph's text node, regardless of the (x, y) it is asked about — jsdom draws
 * no layout, so nothing here can depend on real geometry. */
function stubCaretAt(paragraph: HTMLElement, offset: number): void {
  const textNode = paragraph.firstChild!;
  (document as { caretRangeFromPoint?: (x: number, y: number) => Range }).caretRangeFromPoint = () => {
    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset);
    return range;
  };
}

beforeEach(() => {
  vi.mocked(fetchVersionThreads).mockResolvedValue([THREAD]);
});

/** A real drag: mousedown at an origin, then enough mousemove travel past the
 * threshold that use-threads-layer.ts's own click-vs-drag distinction commits to it. */
function drag(handle: HTMLElement): void {
  fireEvent.mouseDown(handle, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(document, { clientX: 60, clientY: 60 });
}

describe("dragging a Thread: link, move and unlink (#35)", () => {
  it("links onto the reader's own selection when one is live at drop time", async () => {
    await renderSettled();
    const paragraph = screen.getByText(PARAGRAPH_TEXT);
    selectRange(paragraph, 0, 5); // "Hello"

    drag(screen.getByTitle(/drag onto text/i));
    fireEvent.mouseUp(document, { clientX: 10, clientY: 10 });

    await waitFor(() =>
      expect(linkThread).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ threadId: "thread-1", bookId: "book-1", versionNumber: 1, start: 0, end: 5 }),
      ),
    );
  });

  it("links onto the sentence under the cursor when there is no selection", async () => {
    await renderSettled();
    const paragraph = screen.getByText(PARAGRAPH_TEXT);
    stubCaretAt(paragraph, PARAGRAPH_TEXT.indexOf("Second"));

    drag(screen.getByTitle(/drag onto text/i));
    fireEvent.mouseUp(document, { clientX: 10, clientY: 10 });

    await waitFor(() => expect(linkThread).toHaveBeenCalled());
    const call = vi.mocked(linkThread).mock.calls[0]![1];
    expect(PARAGRAPH_TEXT.slice(call.start, call.end)).toBe("Second sentence here.");
  });

  it("unlinks at the nearest character when the drop lands outside the text column", async () => {
    await renderSettled();
    const paragraph = screen.getByText(PARAGRAPH_TEXT);
    stubCaretAt(paragraph, PARAGRAPH_TEXT.indexOf("Second"));

    drag(screen.getByTitle(/drag onto text/i));
    // Outside CONTAINER_RECT's [0, 500] bounds on both axes — a drop in the margin.
    fireEvent.mouseUp(document, { clientX: 600, clientY: 10 });

    await waitFor(() =>
      expect(unlinkThread).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ threadId: "thread-1", placement: PARAGRAPH_TEXT.indexOf("Second") }),
      ),
    );
  });

  it("clears the dragging Thread once the drop is handled", async () => {
    await renderSettled();
    const paragraph = screen.getByText(PARAGRAPH_TEXT);
    stubCaretAt(paragraph, 0);

    drag(screen.getByTitle(/drag onto text/i));
    fireEvent.mouseUp(document, { clientX: 10, clientY: 10 });

    await waitFor(() => expect(linkThread).toHaveBeenCalled());
    // A second mouseup with no drag in progress must not re-fire the write.
    fireEvent.mouseUp(document, { clientX: 10, clientY: 10 });
    expect(linkThread).toHaveBeenCalledTimes(1);
  });

  it("commits nothing on a plain click with no movement (#35 regression)", async () => {
    await renderSettled();
    const paragraph = screen.getByText(PARAGRAPH_TEXT);
    stubCaretAt(paragraph, 0);

    // mousedown then mouseup at the very same point, with no mousemove between them —
    // exactly what a click is, and exactly what must not be read as a completed drag.
    fireEvent.mouseDown(screen.getByTitle(/drag onto text/i), { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(document, { clientX: 10, clientY: 10 });

    await act(async () => {});
    expect(linkThread).not.toHaveBeenCalled();
    expect(unlinkThread).not.toHaveBeenCalled();
  });

  it("cancels a drag in progress on Escape, with no write", async () => {
    await renderSettled();
    const paragraph = screen.getByText(PARAGRAPH_TEXT);
    stubCaretAt(paragraph, 0);

    drag(screen.getByTitle(/drag onto text/i));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseUp(document, { clientX: 10, clientY: 10 });

    await act(async () => {});
    expect(linkThread).not.toHaveBeenCalled();
    expect(unlinkThread).not.toHaveBeenCalled();
  });
});
