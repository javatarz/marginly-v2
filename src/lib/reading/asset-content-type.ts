const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
};

const FALLBACK = "application/octet-stream";

/** What to serve an asset back as (#27) — keyed on the extension alone, the only signal a stored path carries. */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return FALLBACK;
  }

  const extension = path.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? FALLBACK;
}
