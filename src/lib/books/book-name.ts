/**
 * ADR-0008: an empty or whitespace-only name is refused, and the name that survives is
 * stored exactly as the Author typed it — trimming happens only to decide blankness,
 * never to the value kept.
 */
export type BookNameResult = { ok: true; name: string } | { ok: false };

export function validateBookName(raw: string): BookNameResult {
  return raw.trim() === "" ? { ok: false } : { ok: true, name: raw };
}
