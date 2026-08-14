/** Exported so callers can find a selection's containing paragraph (ADR-0004) without
 * duplicating the boundary list a second time. */
export const SEGMENT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "figcaption",
  "div",
]);

const WHITESPACE = /\s/;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** A DOM boundary point — the same shape `Range#setStart`/`setEnd` accept. */
export type DomPosition = { node: Node; offset: number };

export interface TextIndex {
  /** The extracted text itself — identical to what `preview.ts` stores as `text.txt`
   * for the same (sanitised) markup. */
  readonly text: string;
  /** The length of the Version's extracted text this index was built from. */
  readonly length: number;
  /** The DOM position of the character at `charOffset`, or null past the end. */
  resolveOffset(charOffset: number): DomPosition | null;
  /**
   * The character offset nearest to (and never past) `nodeOffset` within `node`. Used
   * to turn a real DOM position — typically from a click, via `caretPositionFromPoint`
   * — back into a character offset. Returns null for a node this index never walked.
   */
  offsetOf(node: Node, nodeOffset: number): number | null;
}

type Char = { ch: string; source: DomPosition | null; synthetic: boolean };

/**
 * Builds the character-offset-to-DOM-position index ADR-0007 requires: it must agree
 * exactly with `supabase/functions/_shared/preview/extract.ts`'s extraction rules, so
 * every structural decision below — segment tags, `<br>` as a space, tables skipped,
 * whitespace collapsed and trimmed per segment — mirrors that file line for line
 * (ADR-0013: two runtimes sharing no code, the same rules implemented twice).
 *
 * `root` is ordinarily the rendered content container, but any DOM subtree works —
 * that is what lets this be tested with `linkedom` instead of a real browser.
 */
export function buildTextIndex(root: Node): TextIndex {
  const chars: Char[] = [];
  let buffer: Char[] = [];

  function flush(): void {
    const collapsed = collapseWhitespace(buffer);
    buffer = [];
    const segment = trim(collapsed);
    if (segment.length === 0) {
      return;
    }
    if (chars.length > 0) {
      chars.push({ ch: " ", source: null, synthetic: true });
    }
    chars.push(...segment);
  }

  function walk(node: Node): void {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        const text = child as Text;
        let i = 0;
        for (const ch of text.data) {
          buffer.push({ ch, source: { node: text, offset: i }, synthetic: false });
          i += ch.length;
        }
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) {
        continue;
      }
      const element = child as Element;
      const tag = element.localName;
      if (tag === "table") {
        continue;
      }
      if (tag === "br") {
        buffer.push({ ch: " ", source: null, synthetic: true });
        continue;
      }
      if (SEGMENT_TAGS.has(tag)) {
        flush();
        walk(element);
        flush();
        continue;
      }
      walk(element);
    }
  }

  walk(root);
  flush();

  fillSyntheticSources(chars);

  const reverse = buildReverseIndex(chars);

  return {
    text: chars.map((char) => char.ch).join(""),
    length: chars.length,
    resolveOffset(charOffset: number): DomPosition | null {
      const char = chars[charOffset];
      return char?.source ?? null;
    },
    offsetOf(node: Node, nodeOffset: number): number | null {
      const positions = reverse.get(node);
      if (!positions) {
        return null;
      }

      // The nearest recorded position at or before `nodeOffset`, falling back to the
      // first recorded position when the click lands before it — a collapsed run of
      // whitespace or a segment's trimmed lead only records its first character, so a
      // point anywhere inside that run resolves to the same output offset.
      let nearest = positions[0]!;
      for (const position of positions) {
        if (position.rawOffset > nodeOffset) {
          break;
        }
        nearest = position;
      }
      return nearest.charIndex;
    },
  };
}

/**
 * The DOM position of the caret at `charOffset` — the character itself when one
 * exists there, or one past the last character when `charOffset` sits exactly at the
 * end of the text. An Unlinked Thread's `thread_position` is a single point rather
 * than a range (ADR-0014), and the match seam clamps a carried placement to the new
 * text's own length (`supabase/functions/_shared/match.ts`) — landing exactly at the
 * end is therefore a real, reachable case, not an edge case to special-case away.
 * Null only when the index holds no text at all.
 */
export function resolvePoint(index: TextIndex, charOffset: number): DomPosition | null {
  const position = index.resolveOffset(charOffset);
  if (position) {
    return position;
  }

  if (index.length === 0) {
    return null;
  }

  const lastCharacter = index.resolveOffset(index.length - 1)!;
  return { node: lastCharacter.node, offset: lastCharacter.offset + 1 };
}

/**
 * The two boundary points a `Range` needs to cover `[start, end)` of the extracted
 * text — `start`'s own position, and the position right after `end`'s last included
 * character. Null if `start` is out of bounds; a Highlight is never empty (the
 * database's own check constraint agrees), so `end` is never less than `start` in
 * practice, but this does not assume it.
 */
export function resolveRange(
  index: TextIndex,
  start: number,
  end: number,
): { start: DomPosition; end: DomPosition } | null {
  const startPosition = index.resolveOffset(start);
  if (!startPosition) {
    return null;
  }

  // `startPosition` being non-null already means `index.length` is at least 1, so
  // `resolvePoint` can never itself return null here.
  return { start: startPosition, end: resolvePoint(index, end)! };
}

/** Mirrors `buffer.replaceAll(/\s+/g, " ")`, keeping each collapsed space's source. */
function collapseWhitespace(buffer: readonly Char[]): Char[] {
  const collapsed: Char[] = [];
  let inWhitespaceRun = false;

  for (const char of buffer) {
    if (WHITESPACE.test(char.ch)) {
      if (!inWhitespaceRun) {
        collapsed.push({ ch: " ", source: char.source, synthetic: char.synthetic });
        inWhitespaceRun = true;
      }
      continue;
    }
    inWhitespaceRun = false;
    collapsed.push(char);
  }

  return collapsed;
}

/** Mirrors `.trim()`, dropping a leading and trailing collapsed space, if present. */
function trim(chars: readonly Char[]): Char[] {
  let start = 0;
  let end = chars.length;
  while (start < end && chars[start]!.ch === " ") {
    start += 1;
  }
  while (end > start && chars[end - 1]!.ch === " ") {
    end -= 1;
  }
  return chars.slice(start, end);
}

/**
 * A `<br>` or an inter-segment join has no text node of its own to anchor a Range to.
 * Each borrows the position of the nearest following real character — the start of the
 * next segment, or of the text right after the `<br>`. `flush`'s `trim` guarantees one
 * always exists: a synthetic character only ever survives into `chars` sitting between
 * two flushed, non-empty runs of real text, never trailing one — a `<br>` at the end of
 * a segment, or a join before an all-whitespace segment, is trimmed away with it.
 */
function fillSyntheticSources(chars: Char[]): void {
  let followingRealSource: DomPosition | null = null;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const char = chars[i]!;
    if (char.synthetic) {
      char.source = followingRealSource;
    } else {
      followingRealSource = char.source;
    }
  }
}

type ReversePosition = { rawOffset: number; charIndex: number };

/** Real (non-synthetic) characters only — nothing is ever rendered at a `<br>` or a
 * paragraph join for a click to land on. */
function buildReverseIndex(chars: readonly Char[]): Map<Node, ReversePosition[]> {
  const byNode = new Map<Node, ReversePosition[]>();

  chars.forEach((char, charIndex) => {
    if (char.synthetic || char.source === null) {
      return;
    }
    const positions = byNode.get(char.source.node) ?? [];
    positions.push({ rawOffset: char.source.offset, charIndex });
    byNode.set(char.source.node, positions);
  });

  for (const positions of byNode.values()) {
    positions.sort((a, b) => a.rawOffset - b.rawOffset);
  }

  return byNode;
}
