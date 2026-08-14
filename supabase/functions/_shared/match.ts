export type TextRange = {
  readonly start: number;
  readonly end: number;
};

export type PreviousLinked = {
  readonly status: "linked";
  readonly textPosition: TextRange;
};

export type PreviousUnlinked = {
  readonly status: "unlinked";
  readonly threadPosition: number;
};

export type Previous = PreviousLinked | PreviousUnlinked;

export type OpenThread = {
  readonly id: string;
  readonly text: { readonly selected: string; readonly paragraph: string } | null;
  readonly previous: Previous;
};

export type MatchedLinked = {
  readonly threadId: string;
  readonly status: "linked";
  readonly textPosition: TextRange;
};

export type MatchedUnlinked = {
  readonly threadId: string;
  readonly status: "unlinked";
  readonly threadPosition: number;
};

export type Matched = MatchedLinked | MatchedUnlinked;

export function matchThreads(
  openThreads: readonly OpenThread[],
  text: string,
): readonly Matched[] {
  return openThreads.map((thread) => matchOne(thread, text));
}

function matchOne(thread: OpenThread, text: string): Matched {
  const linked = thread.text === null ? undefined : link(thread.text, text);
  if (linked !== undefined) {
    return { threadId: thread.id, status: "linked", textPosition: linked };
  }
  return {
    threadId: thread.id,
    status: "unlinked",
    threadPosition: unlinkedPlacement(thread.previous, text.length),
  };
}

function link(
  threadText: { readonly selected: string; readonly paragraph: string },
  text: string,
): TextRange | undefined {
  const selectedOccurrences = findOccurrences(text, threadText.selected);
  if (selectedOccurrences.length === 0) {
    return undefined;
  }
  if (selectedOccurrences.length === 1) {
    return selectedOccurrences[0];
  }

  const paragraphOccurrences = findOccurrences(text, threadText.paragraph);
  const candidates = selectedOccurrences.filter((selected) =>
    paragraphOccurrences.some((paragraph) => contains(paragraph, selected))
  );

  return candidates.length === 1 ? candidates[0] : undefined;
}

function contains(outer: TextRange, inner: TextRange): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

function unlinkedPlacement(previous: Previous, textLength: number): number {
  const raw = previous.status === "linked"
    ? previous.textPosition.start
    : previous.threadPosition;
  return Math.min(raw, textLength);
}

function findOccurrences(haystack: string, needle: string): TextRange[] {
  const normalised = needle.trim().replaceAll(/\s+/g, " ");
  if (normalised.length === 0) {
    // An empty pattern would match a zero-length string at every position without ever
    // advancing past it, looping forever below — a whitespace-only selected or
    // paragraph text (start_thread accepts either, uninspected) can produce one.
    return [];
  }
  const pattern = new RegExp(toWhitespaceTolerantPattern(normalised), "g");
  const ranges: TextRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(haystack)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function toWhitespaceTolerantPattern(normalised: string): string {
  return normalised
    .replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(" ", "\\s+");
}
