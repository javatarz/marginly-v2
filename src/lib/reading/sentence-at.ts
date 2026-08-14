/**
 * "The sentence under the cursor" (ADR-0007/ADR-0014) — the drop target for re-linking a
 * Thread when the reader has no selection of their own. Pure text math: the caller finds
 * the containing paragraph and the cursor's offset within it (DOM work, in
 * use-threads-layer.ts); this decides where that one sentence starts and ends.
 *
 * A sentence ends at `.`, `!` or `?` followed by whitespace or the text's own end.
 * `offset` lands in a sentence's own content or in the whitespace trailing it — both
 * count as that sentence; landing in the gap *before* the next sentence's content (there
 * is no such gap once trailing whitespace is assigned backward) cannot arise from how the
 * boundaries below are built.
 */
export function sentenceRange(text: string, offset: number): readonly [number, number] {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const sentences = sentenceBoundaries(text);

  for (const sentence of sentences) {
    if (clamped <= sentence[1]) {
      return sentence;
    }
  }

  return sentences[sentences.length - 1]!;
}

function sentenceBoundaries(text: string): Array<[number, number]> {
  const boundaries: Array<[number, number]> = [];
  const terminator = /[.!?]+(?=\s|$)/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = terminator.exec(text)) !== null) {
    const end = match.index + match[0].length;
    boundaries.push(trimmedRange(text, start, end));
    start = end;
  }

  if (start < text.length) {
    boundaries.push(trimmedRange(text, start, text.length));
  }

  return boundaries.length > 0 ? boundaries : [[0, text.length]];
}

/** Drops leading/trailing whitespace from `[start, end)` without moving either bound
 * past the other — the same shape `text-index.ts`'s own `trim` keeps. */
function trimmedRange(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) {
    s += 1;
  }
  while (e > s && /\s/.test(text[e - 1]!)) {
    e -= 1;
  }
  return [s, e];
}
