// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadsOverlay } from "./threads-overlay";
import { useThreadsLayer } from "./use-threads-layer";
import { fetchVersionThreads } from "./threads-api";

// Boundary mocks (CODING_STANDARDS.md §3): the Supabase client and the
// threads-api I/O adapter, never useThreadsLayer's own selection logic.
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({}),
}));
vi.mock("./threads-api", () => ({
  fetchVersionThreads: vi.fn().mockResolvedValue([]),
  startThread: vi.fn(),
}));

// jsdom has no layout engine, so it never ships ResizeObserver — the redraw
// effect only needs one to exist, never to actually fire.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

// jsdom has no layout engine, so Range never implements getClientRects — the
// code only needs a last rect to anchor the button, never real geometry.
const FAKE_RECT = { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 } as DOMRect;
Range.prototype.getClientRects = () => [FAKE_RECT] as unknown as DOMRectList;

afterEach(cleanup);

function Harness() {
  const contentRef = useRef<HTMLDivElement>(null);
  const state = useThreadsLayer({
    bookId: "book-1",
    versionNumber: 1,
    isLatest: true,
    contentRef,
  });
  return (
    <div ref={contentRef}>
      <p>Hello world</p>
      <ThreadsOverlay state={state} />
    </div>
  );
}

// The version-switch effect (use-threads-layer.ts:80-94) fetches on mount and,
// on resolving, nulls `pendingSelection` along with everything else. If that
// resolution lands after a test's own selection, it silently unmounts the
// button underneath the test. Flushing it first removes that race.
async function renderSettled(): Promise<void> {
  render(<Harness />);
  await waitFor(() => expect(fetchVersionThreads).toHaveBeenCalled());
  await act(async () => {});
}

function selectWord(paragraph: HTMLElement): void {
  const textNode = paragraph.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 5); // "Hello"

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("ThreadsOverlay: Start a Thread (issue #29 regression)", () => {
  it("opens the composer on click after a text selection", async () => {
    await renderSettled();
    const paragraph = screen.getByText("Hello world");
    selectWord(paragraph);

    const button = await screen.findByRole("button", { name: "Start a Thread" });
    fireEvent.click(button);

    expect(await screen.findByPlaceholderText("Write the first Comment…")).toBeInTheDocument();
  });

  it("prevents mousedown's default so the browser cannot collapse the selection before click", async () => {
    await renderSettled();
    const paragraph = screen.getByText("Hello world");
    selectWord(paragraph);

    const button = await screen.findByRole("button", { name: "Start a Thread" });
    const event = fireEvent.mouseDown(button);

    // fireEvent returns false when the dispatched event's preventDefault() was
    // called — this is the exact line (threads-overlay.tsx) that stops a real
    // browser from collapsing the live selection before `click` can fire and
    // read it. Without it, `pendingSelection` goes null and this button
    // unmounts before `openComposer` ever runs (#29).
    expect(event).toBe(false);
  });

  it("does not render the button once the selection collapses", async () => {
    await renderSettled();
    const paragraph = screen.getByText("Hello world");
    selectWord(paragraph);
    await screen.findByRole("button", { name: "Start a Thread" });

    act(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Start a Thread" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the composer open once the textarea's autoFocus steals and collapses the selection", async () => {
    // A real browser clears window.getSelection() when focus moves into a
    // form control, same as the composer's own autoFocus textarea does here
    // (verified against jsdom, which implements this the same way) — firing
    // selectionchange right as the composer opens. Left unguarded, the effect
    // above reads that as "selection abandoned" and nulls pendingSelection,
    // unmounting the composer it just opened (#29's second half).
    await renderSettled();
    const paragraph = screen.getByText("Hello world");
    selectWord(paragraph);

    const button = await screen.findByRole("button", { name: "Start a Thread" });
    fireEvent.click(button);

    const textarea = await screen.findByPlaceholderText("Write the first Comment…");
    expect(document.activeElement).toBe(textarea);
    expect(window.getSelection()!.isCollapsed).toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByPlaceholderText("Write the first Comment…")).toBeInTheDocument();
  });
});
