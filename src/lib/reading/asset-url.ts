/** The access-checked route (#27) a Version's asset lives behind, never the Storage path directly. */
export function assetUrl(bookId: string, versionNumber: number, relativePath: string): string {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `/books/${bookId}/versions/${versionNumber}/assets/${encodedPath}`;
}
