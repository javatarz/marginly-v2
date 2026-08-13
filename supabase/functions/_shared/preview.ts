import { DOMParser } from "@b-fuze/deno-dom";

import { extractSegments } from "./preview/extract.ts";
import { hashFiles } from "./preview/hash.ts";
import { sanitise } from "./preview/sanitise.ts";
import { unzip, type UnzippedFile } from "./preview/unzip.ts";

const HTML_BYTE_LIMIT = 10 * 1024 * 1024;
const PREVIEW_SEGMENTS = 20;

export type PreviewRefusal = {
  readonly ok: false;
  readonly message: string;
};

export type PreviewSuccess = {
  readonly ok: true;
  readonly hash: string;
  readonly html: string;
  readonly text: string;
  readonly firstTwentySegments: readonly string[];
  readonly removedTagCount: number;
};

export type PreviewResult = PreviewSuccess | PreviewRefusal;

export async function previewUpload(zip: Uint8Array): Promise<PreviewResult> {
  let files: readonly UnzippedFile[];
  try {
    files = await unzip(zip);
  } catch {
    return { ok: false, message: "This zip could not be read." };
  }

  const index = files.find((file) => file.path === "index.html");
  if (index === undefined) {
    return { ok: false, message: "This zip has no index.html at its root." };
  }

  if (index.bytes.length > HTML_BYTE_LIMIT) {
    return {
      ok: false,
      message: "Its index.html is over the 10 MB limit.",
    };
  }

  const hash = await hashFiles(files);
  const document = new DOMParser().parseFromString(
    new TextDecoder().decode(index.bytes),
    "text/html",
  );
  const removedTagCount = sanitise(document);
  const segments = extractSegments(document);

  return {
    ok: true,
    hash,
    html: document.body!.innerHTML,
    text: segments.join(" "),
    firstTwentySegments: segments.slice(0, PREVIEW_SEGMENTS),
    removedTagCount,
  };
}
