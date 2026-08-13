/**
 * Renders an Upload's instant as a date, in whichever zone is asked for. Left undefined,
 * `Intl.DateTimeFormat` falls back to the runtime's own zone — the browser's, when this
 * runs client-side — so the same function reads locally for a reader and deterministically
 * in a test that names a zone.
 */
export function formatUploadDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}
