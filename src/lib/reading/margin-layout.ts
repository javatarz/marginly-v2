export type MarginItem = {
  readonly id: string;
  /** The vertical position the Thread's own text asks for. */
  readonly naturalTop: number;
  /** The measured height of the Thread's own box in the margin. */
  readonly height: number;
  /** Tie-break for two Threads asking for the same position — creation order. */
  readonly sequence: number;
};

export type MarginPosition = { readonly id: string; readonly top: number };

/**
 * ADR-0007/ADR-0014's margin layout: each Thread is pinned to the vertical position of
 * its text and nudged **downward only** far enough that two Threads never overlap. A
 * hand placement is a request rather than a coordinate, so this is the same nudging
 * whether `naturalTop` came from a Highlight's own position or from a drag — settling
 * from wherever it was asked to sit rather than snapping to it.
 *
 * `gap` is a caller-supplied minimum space between two settled Threads; it defaults to
 * none, which still guarantees no overlap.
 */
export function layoutMargin(items: readonly MarginItem[], gap = 0): MarginPosition[] {
  const ordered = [...items].sort(
    (a, b) => a.naturalTop - b.naturalTop || a.sequence - b.sequence,
  );

  const positions: MarginPosition[] = [];
  let cursor = -Infinity;

  for (const item of ordered) {
    const top = Math.max(item.naturalTop, cursor);
    positions.push({ id: item.id, top });
    cursor = top + item.height + gap;
  }

  return positions;
}
