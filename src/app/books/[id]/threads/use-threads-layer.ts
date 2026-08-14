import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildTextIndex, resolveRange, SEGMENT_TAGS, type TextIndex } from "@/lib/reading/text-index";
import { layoutMargin, type MarginPosition } from "@/lib/reading/margin-layout";
import { nextSelectedThreadId } from "@/lib/reading/next-selected-thread";
import { mergeIntervals, type Interval } from "@/lib/reading/union-intervals";
import { createClient } from "@/lib/supabase/browser";

import {
  addComment,
  deleteComment,
  editComment,
  fetchVersionThreads,
  resolveThread,
  startThread,
  type ThreadData,
} from "./threads-api";

export type Rect = { top: number; left: number; width: number; height: number };

export type PendingSelection = {
  start: number;
  end: number;
  selectedText: string;
  paragraphText: string;
  anchorTop: number;
  anchorLeft: number;
};

export type ThreadsLayerState = {
  orderedThreads: readonly ThreadData[];
  selectedThreadId: string | null;
  selectThread: (id: string | null) => void;
  unionRects: readonly Rect[];
  selectedRects: readonly Rect[];
  marginPositions: readonly MarginPosition[];
  registerMarginBox: (threadId: string, el: HTMLDivElement | null) => void;
  pendingSelection: PendingSelection | null;
  composerOpen: boolean;
  openComposer: () => void;
  composerBody: string;
  setComposerBody: (body: string) => void;
  submitError: string | null;
  submitting: boolean;
  cancelComposer: () => void;
  submitComment: () => void;
  isLatest: boolean;
  replyBody: string;
  setReplyBody: (body: string) => void;
  replyError: string | null;
  replySubmitting: boolean;
  submitReply: () => void;
  editingCommentId: string | null;
  editingBody: string;
  setEditingBody: (body: string) => void;
  editError: string | null;
  editSubmitting: boolean;
  startEditingComment: (commentId: string, currentBody: string) => void;
  cancelEditingComment: () => void;
  submitEditComment: () => void;
  deletingCommentId: string | null;
  deleteErrorCommentId: string | null;
  deleteError: string | null;
  removeComment: (commentId: string) => void;
  resolveNote: string;
  setResolveNote: (note: string) => void;
  resolveSubmitting: boolean;
  resolveError: string | null;
  submitResolve: (threadId: string) => void;
};

/**
 * All of the Highlight-and-margin state (ADR-0007) for one Version, shared between
 * `ThreadsOverlay` (drawn over the text) and `ThreadsMargin` (drawn in the margin
 * column) — the two need the same Thread list and the same selection, but live in
 * different positioning contexts in `reader.tsx`'s layout, so a page component that
 * rendered both from one fragment could not place them in different CSS ancestors.
 */
export function useThreadsLayer({
  bookId,
  versionNumber,
  isLatest,
  contentRef,
}: {
  bookId: string;
  versionNumber: number;
  isLatest: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
}): ThreadsLayerState {
  const supabase = useMemo(() => createClient(), []);

  const [threads, setThreads] = useState<readonly ThreadData[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerBody, setComposerBody] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [deleteErrorCommentId, setDeleteErrorCommentId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [resolveNote, setResolveNote] = useState("");
  const [resolveSubmitting, setResolveSubmitting] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [unionRects, setUnionRects] = useState<readonly Rect[]>([]);
  const [selectedRects, setSelectedRects] = useState<readonly Rect[]>([]);
  const [marginTops, setMarginTops] = useState<ReadonlyMap<string, number>>(new Map());
  const [marginHeights, setMarginHeights] = useState<ReadonlyMap<string, number>>(new Map());

  const marginBoxRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const marginHeightObserverRef = useRef<ResizeObserver | null>(null);

  // This Version's discussion (the shared read, `version_threads`). A pending
  // selection or an open composer belongs to whichever Version was on screen when the
  // drag happened — switching Versions (#27) leaves both behind rather than carrying
  // them onto text they were never drawn against.
  useEffect(() => {
    let cancelled = false;
    fetchVersionThreads(supabase, bookId, versionNumber).then((data) => {
      if (!cancelled) {
        setThreads(data);
        setSelectedThreadId(null);
        setPendingSelection(null);
        setComposerOpen(false);
        setComposerBody("");
        setReplyBody("");
        setReplyError(null);
        setEditingCommentId(null);
        setEditingBody("");
        setEditError(null);
        setDeleteErrorCommentId(null);
        setDeleteError(null);
        setResolveNote("");
        setResolveError(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, bookId, versionNumber, isLatest]);

  const orderedThreads = useMemo(
    () => [...threads].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [threads],
  );

  // Highlights: rectangles over the text, recomputed at read time and thrown away on
  // the next paint (ADR-0007). Every Linked Thread's range is merged into a union
  // interval set first, so overlap and nesting leave no trace; a selected Thread draws
  // its own range again, on top.
  const redraw = useCallback(() => {
    const container = contentRef.current;
    if (!container) {
      return;
    }

    const index = buildTextIndex(container);
    const containerRect = container.getBoundingClientRect();

    const ranges: Interval[] = orderedThreads.map((thread) => thread.range);
    setUnionRects(rectsForRanges(index, containerRect, mergeIntervals(ranges)));

    const selected = orderedThreads.find((thread) => thread.threadId === selectedThreadId);
    setSelectedRects(selected ? rectsForRanges(index, containerRect, [selected.range]) : []);

    const tops = new Map<string, number>();
    orderedThreads.forEach((thread) => {
      const rects = rectsForRanges(index, containerRect, [thread.range]);
      tops.set(thread.threadId, rects[0]?.top ?? 0);
    });
    setMarginTops(tops);
  }, [contentRef, orderedThreads, selectedThreadId]);

  // Redrawn on resize and as images load (ADR-0007) — a Version's own CSS is gone
  // (ADR-0012), so image loading is the only thing left that can reflow the text.
  useEffect(() => {
    redraw();

    const container = contentRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(redraw);
    observer.observe(container);

    function handleLoad(event: Event): void {
      if (event.target instanceof HTMLImageElement) {
        redraw();
      }
    }
    container.addEventListener("load", handleLoad, true);
    window.addEventListener("resize", redraw);

    return () => {
      observer.disconnect();
      container.removeEventListener("load", handleLoad, true);
      window.removeEventListener("resize", redraw);
    };
  }, [redraw, contentRef]);

  // A Thread's own box is measured after it renders, never during — reading a ref's
  // value at render time would race the box's own layout. A ResizeObserver per box also
  // catches a box's height changing on its own, from nothing else here already
  // redraws for — a Comment's text wrapping differently at a new width.
  const measureMarginHeights = useCallback(() => {
    const heights = new Map<string, number>();
    marginBoxRefs.current.forEach((el, id) => heights.set(id, el.getBoundingClientRect().height));
    setMarginHeights((previous) => (mapsEqual(previous, heights) ? previous : heights));
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(measureMarginHeights);
    marginHeightObserverRef.current = observer;
    marginBoxRefs.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      marginHeightObserverRef.current = null;
    };
  }, [measureMarginHeights]);

  const registerMarginBox = useCallback((threadId: string, el: HTMLDivElement | null) => {
    if (el) {
      marginBoxRefs.current.set(threadId, el);
      marginHeightObserverRef.current?.observe(el);
    } else {
      const previous = marginBoxRefs.current.get(threadId);
      if (previous) {
        marginHeightObserverRef.current?.unobserve(previous);
      }
      marginBoxRefs.current.delete(threadId);
    }
  }, []);

  // The margin's own downward-only nudging, keyed on each Thread's natural top and its
  // own measured height so two Threads never overlap (ADR-0007/ADR-0014).
  const marginPositions = useMemo(() => {
    const items = orderedThreads.map((thread, sequence) => ({
      id: thread.threadId,
      naturalTop: marginTops.get(thread.threadId) ?? 0,
      height: marginHeights.get(thread.threadId) ?? 80,
      sequence,
    }));
    return layoutMargin(items, 16);
  }, [orderedThreads, marginTops, marginHeights]);

  // Starting a Thread: a plain text drag ending in one affordance at the end of the
  // selection (ADR-0007) — never a per-element control.
  useEffect(() => {
    // Once the composer is open, its own autoFocus textarea deselects the
    // page's text (a real browser clears window.getSelection() when focus
    // moves into a form control) and fires this same selectionchange — left
    // unguarded, that reads as "the user abandoned the selection" and nulls
    // pendingSelection out from under the composer that just opened (#29).
    if (!isLatest || composerOpen) {
      return;
    }

    function handleSelectionChange(): void {
      const container = contentRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setPendingSelection(null);
        return;
      }

      const range = selection.getRangeAt(0);
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
        setPendingSelection(null);
        return;
      }

      const index = buildTextIndex(container);
      const start = index.offsetOf(range.startContainer, range.startOffset);
      const end = index.offsetOf(range.endContainer, range.endOffset);
      if (start === null || end === null || end <= start) {
        setPendingSelection(null);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const rects = range.getClientRects();
      const last = rects[rects.length - 1];
      if (!last) {
        setPendingSelection(null);
        return;
      }

      setPendingSelection({
        start,
        end,
        selectedText: normalizeWhitespace(index.text.slice(start, end)),
        paragraphText: normalizeWhitespace(paragraphTextAround(range.startContainer)),
        anchorTop: last.bottom - containerRect.top,
        anchorLeft: last.right - containerRect.left,
      });
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [contentRef, isLatest, composerOpen]);

  // Clicking a shared Highlight cycles which Thread is selected (ADR-0007). A plain
  // click reports a collapsed selection; a drag's mouseup does not, and opens the
  // composer above instead of cycling.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) {
      return;
    }

    function handleClick(event: MouseEvent): void {
      if (!container || !window.getSelection()?.isCollapsed) {
        return;
      }

      const offset = characterOffsetAt(container, event.clientX, event.clientY);
      if (offset === null) {
        return;
      }

      const covering = orderedThreads.filter(
        (thread) => offset >= thread.range[0] && offset < thread.range[1],
      );
      if (covering.length === 0) {
        return;
      }

      const currentIndex = covering.findIndex((thread) => thread.threadId === selectedThreadId);
      const next = covering[(currentIndex + 1) % covering.length]!;
      setSelectedThreadId(next.threadId);
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [contentRef, orderedThreads, selectedThreadId]);

  const submitComment = useCallback(() => {
    if (!pendingSelection || composerBody.trim().length === 0) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    startThread(supabase, {
      bookId,
      start: pendingSelection.start,
      end: pendingSelection.end,
      selectedText: pendingSelection.selectedText,
      paragraphText: pendingSelection.paragraphText,
      body: composerBody.trim(),
    }).then((result) => {
      setSubmitting(false);

      if ("error" in result) {
        setSubmitError(result.error);
        return;
      }

      window.getSelection()?.removeAllRanges();
      setPendingSelection(null);
      setComposerOpen(false);
      setComposerBody("");
      setSelectedThreadId(result.threadId);
      fetchVersionThreads(supabase, bookId, versionNumber).then(setThreads);
    });
  }, [pendingSelection, composerBody, supabase, bookId, versionNumber]);

  // Replying to a Thread that already exists — the same shape as `submitComment`
  // above, minus the Highlight: `add_comment` computes the Thread's Book and the
  // Book's own latest Version itself (this ticket's migration), so there is nothing
  // here for the client to get wrong by being stale.
  const submitReply = useCallback(() => {
    if (!selectedThreadId || replyBody.trim().length === 0) {
      return;
    }

    setReplySubmitting(true);
    setReplyError(null);

    addComment(supabase, { threadId: selectedThreadId, body: replyBody.trim() }).then((result) => {
      setReplySubmitting(false);

      if ("error" in result) {
        setReplyError(result.error);
        return;
      }

      setReplyBody("");
      fetchVersionThreads(supabase, bookId, versionNumber).then(setThreads);
    });
  }, [selectedThreadId, replyBody, supabase, bookId, versionNumber]);

  const startEditingComment = useCallback((commentId: string, currentBody: string) => {
    setEditingCommentId(commentId);
    setEditingBody(currentBody);
    setEditError(null);
  }, []);

  const cancelEditingComment = useCallback(() => {
    setEditingCommentId(null);
    setEditingBody("");
    setEditError(null);
  }, []);

  const submitEditComment = useCallback(() => {
    if (!editingCommentId || editingBody.trim().length === 0) {
      return;
    }

    setEditSubmitting(true);
    setEditError(null);

    editComment(supabase, { commentId: editingCommentId, body: editingBody.trim() }).then((result) => {
      setEditSubmitting(false);

      if (result?.error) {
        setEditError(result.error);
        return;
      }

      setEditingCommentId(null);
      setEditingBody("");
      fetchVersionThreads(supabase, bookId, versionNumber).then(setThreads);
    });
  }, [editingCommentId, editingBody, supabase, bookId, versionNumber]);

  // Deleting the last Comment in a Thread deletes the Thread itself (ADR-0006), entirely
  // in the database — refetching the Version's Threads afterward is what picks that up
  // here, the same as any other mutation in this hook. A refused delete (another
  // person's Comment, or a Version that is no longer latest) surfaces the same way a
  // refused edit or reply does, rather than failing silently.
  const removeComment = useCallback(
    (commentId: string) => {
      setDeletingCommentId(commentId);
      setDeleteErrorCommentId(null);
      setDeleteError(null);

      deleteComment(supabase, { commentId }).then((result) => {
        setDeletingCommentId(null);

        if (result?.error) {
          setDeleteErrorCommentId(commentId);
          setDeleteError(result.error);
          return;
        }

        fetchVersionThreads(supabase, bookId, versionNumber).then((data) => {
          setThreads(data);
          setSelectedThreadId((current) => nextSelectedThreadId(current, data));
        });
      });
    },
    [supabase, bookId, versionNumber],
  );

  // Resolving a Thread (#31), optionally with a final note. The note textarea is
  // shared across every Thread box rather than keyed per Thread — only one Thread can
  // be selected at a time, and `submitResolve` takes the Thread it is resolving
  // explicitly, so nothing here needs to track which box the note belongs to.
  const submitResolve = useCallback(
    (threadId: string) => {
      setResolveSubmitting(true);
      setResolveError(null);

      const note = resolveNote.trim();
      resolveThread(supabase, { threadId, note: note.length > 0 ? note : null }).then((result) => {
        setResolveSubmitting(false);

        if (result?.error) {
          setResolveError(result.error);
          return;
        }

        setResolveNote("");
        fetchVersionThreads(supabase, bookId, versionNumber).then(setThreads);
      });
    },
    [resolveNote, supabase, bookId, versionNumber],
  );

  return {
    orderedThreads,
    selectedThreadId,
    selectThread: setSelectedThreadId,
    unionRects,
    selectedRects,
    marginPositions,
    registerMarginBox,
    pendingSelection,
    composerOpen,
    openComposer: () => setComposerOpen(true),
    composerBody,
    setComposerBody,
    submitError,
    submitting,
    cancelComposer: () => {
      setComposerOpen(false);
      setComposerBody("");
    },
    submitComment,
    isLatest,
    replyBody,
    setReplyBody,
    replyError,
    replySubmitting,
    submitReply,
    editingCommentId,
    editingBody,
    setEditingBody,
    editError,
    editSubmitting,
    startEditingComment,
    cancelEditingComment,
    submitEditComment,
    deletingCommentId,
    deleteErrorCommentId,
    deleteError,
    removeComment,
    resolveNote,
    setResolveNote,
    resolveSubmitting,
    resolveError,
    submitResolve,
  };
}

function rectsForRanges(
  index: TextIndex,
  containerRect: DOMRect,
  ranges: readonly Interval[],
): Rect[] {
  const rects: Rect[] = [];

  for (const [start, end] of ranges) {
    const boundary = resolveRange(index, start, end);
    if (!boundary) {
      continue;
    }

    const range = document.createRange();
    range.setStart(boundary.start.node, boundary.start.offset);
    range.setEnd(boundary.end.node, boundary.end.offset);

    for (const rect of Array.from(range.getClientRects())) {
      rects.push({
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        width: rect.width,
        height: rect.height,
      });
    }
  }

  return rects;
}

/** `caretPositionFromPoint` where available, `caretRangeFromPoint` otherwise — both
 * report a real DOM position for a click, never something to be unit tested against. */
function characterOffsetAt(container: HTMLElement, x: number, y: number): number | null {
  const documentWithCaretApi = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const position = documentWithCaretApi.caretPositionFromPoint
    ? documentWithCaretApi.caretPositionFromPoint(x, y)
    : null;
  if (position) {
    return buildTextIndex(container).offsetOf(position.offsetNode, position.offset);
  }

  const range = documentWithCaretApi.caretRangeFromPoint?.(x, y) ?? null;
  if (range) {
    return buildTextIndex(container).offsetOf(range.startContainer, range.startOffset);
  }

  return null;
}

/** The nearest ancestor segment element's own text (ADR-0004's other matching input). */
function paragraphTextAround(node: Node): string {
  let element: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (element && !SEGMENT_TAGS.has(element.localName)) {
    element = element.parentElement;
  }
  return element ? buildTextIndex(element).text : "";
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function mapsEqual(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false;
    }
  }
  return true;
}
