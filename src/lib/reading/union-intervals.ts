export type Interval = readonly [start: number, end: number];

/**
 * ADR-0007: every Linked Thread's range on a Version is merged into a union interval
 * set before drawing, so overlap and nesting leave no trace — the uniform shading is
 * required to look the same over one Thread's Highlight and over five overlapping ones.
 * `[start, end)` throughout, matching `text_position`'s own `int4range` bounds.
 */
export function mergeIntervals(ranges: readonly Interval[]): Interval[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]!.slice() as [number, number]];

  for (const [start, end] of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (start > last[1]) {
      merged.push([start, end]);
    } else if (end > last[1]) {
      last[1] = end;
    }
  }

  return merged;
}
