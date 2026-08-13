/**
 * Whether the reading view should jump to a newly landed Version (#27, ADR-0011): an
 * Upload always lands as the next Version after the latest, and a reader who was
 * following the latest Version stays on it as it moves — but a reader who had already
 * switched away to an older Version is left exactly where they were, the same as any
 * other Upload while reading an older Version.
 */
export function shouldFollowLatestVersion({
  currentVersionNumber,
  previousLatestVersionNumber,
  nextLatestVersionNumber,
}: {
  currentVersionNumber: number;
  previousLatestVersionNumber: number;
  nextLatestVersionNumber: number;
}): boolean {
  return (
    nextLatestVersionNumber !== previousLatestVersionNumber &&
    currentVersionNumber === previousLatestVersionNumber
  );
}
