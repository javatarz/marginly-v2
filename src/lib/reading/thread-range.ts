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

/** The inverse of `parseTextPosition` — the canonical `int4range` literal PostgREST
 * accepts for a `text_position` write (#35's `linkThread`). */
export function formatTextPosition(start: number, end: number): string {
  return `[${start},${end})`;
}

export type ThreadStatus = "linked" | "unlinked";

/**
 * `version_threads`' `status` column comes back typed as a plain `string` — Postgres'
 * own `check (status in ('linked','unlinked'))` constraint (ADR-0006) is the real
 * guarantee, but nothing carries that constraint into the generated TypeScript types,
 * so a silent `as` cast at the boundary would let a third status value pass through
 * unnoticed. This is the one place that narrowing happens, checked rather than assumed.
 */
export function parseThreadStatus(status: string): ThreadStatus {
  if (status !== "linked" && status !== "unlinked") {
    throw new Error(`not a Thread status: ${status}`);
  }

  return status;
}
