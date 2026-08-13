import { assertEquals } from "@std/assert";

import type { PreviewSuccess } from "./preview.ts";
import {
  isBookId,
  planVersionObjects,
  stagingZipPath,
  storageCleanupPlan,
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

Deno.test("cleans up only the staged copies once the Version has committed", () => {
  assertEquals(
    storageCleanupPlan("committed", ["b/1/index.html"], ["b/1/index.html"]),
    [{ bucket: "staging", paths: ["b/1/index.html"] }],
  );
});

Deno.test("leaves storage untouched on commit if nothing had been staged yet", () => {
  assertEquals(storageCleanupPlan("committed", [], []), []);
});

Deno.test("cleans up both the copies and the staged objects on failure", () => {
  assertEquals(
    storageCleanupPlan("failed", ["b/1/index.html"], ["b/1/index.html"]),
    [
      { bucket: "versions", paths: ["b/1/index.html"] },
      { bucket: "staging", paths: ["b/1/index.html"] },
    ],
  );
});

Deno.test("skips a bucket on failure if nothing had reached it yet", () => {
  assertEquals(
    storageCleanupPlan("failed", ["b/1/index.html"], []),
    [{ bucket: "staging", paths: ["b/1/index.html"] }],
  );
});
