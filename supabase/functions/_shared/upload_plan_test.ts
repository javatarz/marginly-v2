import { assertEquals } from "@std/assert";

import type { PreviewSuccess } from "./preview.ts";
import {
  confirmCleanupPlan,
  isBookId,
  isDuplicateOfLatest,
  pendingManifestPath,
  pendingObjectPath,
  pendingPrefix,
  planPendingManifest,
  planVersionObjects,
  stagingZipPath,
  versionObjectPath,
} from "./upload_plan.ts";

function preview(overrides: Partial<PreviewSuccess> = {}): PreviewSuccess {
  return {
    ok: true,
    hash: "hash",
    html: "<p>sanitised</p>",
    text: "sanitised",
    firstTwentySegments: ["sanitised"],
    removedTagCount: 0,
    ...overrides,
  };
}

Deno.test("plans the sanitised index.html and the extracted text", () => {
  const objects = planVersionObjects([{ path: "index.html", bytes: new Uint8Array() }], preview());

  assertEquals(objects.map((object) => object.path), ["index.html", "text.txt"]);
  assertEquals(new TextDecoder().decode(objects[0].bytes), "<p>sanitised</p>");
  assertEquals(new TextDecoder().decode(objects[1].bytes), "sanitised");
});

Deno.test("carries an asset alongside the HTML at its original relative path", () => {
  const objects = planVersionObjects(
    [
      { path: "index.html", bytes: new Uint8Array() },
      { path: "images/fig1.png", bytes: new Uint8Array([1, 2, 3]) },
    ],
    preview(),
  );

  const asset = objects.find((object) => object.path === "images/fig1.png");
  assertEquals(asset?.bytes, new Uint8Array([1, 2, 3]));
});

Deno.test("drops any other .html file", () => {
  const objects = planVersionObjects(
    [
      { path: "index.html", bytes: new Uint8Array() },
      { path: "chapter.html", bytes: new Uint8Array() },
    ],
    preview(),
  );

  assertEquals(objects.some((object) => object.path === "chapter.html"), false);
});

Deno.test("drops a stylesheet", () => {
  const objects = planVersionObjects(
    [
      { path: "index.html", bytes: new Uint8Array() },
      { path: "style.css", bytes: new Uint8Array() },
    ],
    preview(),
  );

  assertEquals(objects.some((object) => object.path === "style.css"), false);
});

Deno.test("computes the staging zip path from the Book id", () => {
  assertEquals(stagingZipPath("book-1"), "book-1/upload.zip");
});

Deno.test("computes a Version object path from the Book id, the Version number and a relative path", () => {
  assertEquals(versionObjectPath("book-1", 3, "images/fig1.png"), "book-1/3/images/fig1.png");
});

Deno.test("accepts a uuid Book id", () => {
  assertEquals(isBookId("2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d"), true);
});

Deno.test("rejects a Book id that is not a uuid", () => {
  assertEquals(isBookId("book-1"), false);
  assertEquals(isBookId(""), false);
});

Deno.test("computes the pending prefix from the Book id", () => {
  assertEquals(pendingPrefix("book-1"), "book-1/pending");
});

Deno.test("computes a pending object path from the Book id and a relative path", () => {
  assertEquals(pendingObjectPath("book-1", "images/fig1.png"), "book-1/pending/images/fig1.png");
});

Deno.test("computes the pending manifest path from the Book id", () => {
  assertEquals(pendingManifestPath("book-1"), "book-1/pending/manifest.json");
});

Deno.test("plans a manifest holding the hash and every planned object's path", () => {
  const manifest = planPendingManifest(
    [
      { path: "index.html", bytes: new Uint8Array() },
      { path: "text.txt", bytes: new Uint8Array() },
      { path: "images/fig1.png", bytes: new Uint8Array() },
    ],
    "abc123",
  );

  assertEquals(manifest, {
    hash: "abc123",
    paths: ["index.html", "text.txt", "images/fig1.png"],
  });
});

Deno.test("a hash matching the latest Version's is a duplicate", () => {
  assertEquals(isDuplicateOfLatest("abc123", "abc123"), true);
});

Deno.test("a hash differing from the latest Version's is not a duplicate", () => {
  assertEquals(isDuplicateOfLatest("abc123", "def456"), false);
});

Deno.test("nothing is a duplicate of a Book with no latest Version", () => {
  assertEquals(isDuplicateOfLatest("abc123", null), false);
});

Deno.test("cleans up the whole staged bundle once the Version has committed", () => {
  assertEquals(
    confirmCleanupPlan("committed", ["b/upload.zip", "b/pending/manifest.json"], [
      "b/1/index.html",
    ]),
    [{ bucket: "staging", paths: ["b/upload.zip", "b/pending/manifest.json"] }],
  );
});

Deno.test("leaves storage untouched on commit if nothing had been staged yet", () => {
  assertEquals(confirmCleanupPlan("committed", [], []), []);
});

Deno.test("rolls back only the Version's copies on failure, leaving staging for a retry", () => {
  assertEquals(
    confirmCleanupPlan("failed", ["b/upload.zip", "b/pending/manifest.json"], [
      "b/1/index.html",
    ]),
    [{ bucket: "versions", paths: ["b/1/index.html"] }],
  );
});

Deno.test("skips the versions bucket on failure if nothing had been copied yet", () => {
  assertEquals(confirmCleanupPlan("failed", ["b/upload.zip"], []), []);
});
