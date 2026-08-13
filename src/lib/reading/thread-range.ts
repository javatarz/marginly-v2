/**
 * `text_position` comes back from Postgres as an `int4range`'s canonical text form —
 * always `[start,end)` for a non-empty integer range, lower inclusive and upper
 * exclusive, matching `union-intervals.ts`'s own `[start, end)` convention.
 */
export function parseTextPosition(range: string): readonly [number, number] {
  const match = /^\[(-?\d+),(-?\d+)\)$/.exec(range);
  if (!match) {
    throw new Error(`not a canonical int4range: ${range}`);
  }

  return [Number(match[1]), Number(match[2])];
}
