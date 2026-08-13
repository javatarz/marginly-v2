import { describe, expect, it } from "vitest";

import { contentTypeFor } from "./asset-content-type";

describe("contentTypeFor", () => {
  it.each([
    ["fig1.png", "image/png"],
    ["fig1.PNG", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["icon.gif", "image/gif"],
    ["diagram.svg", "image/svg+xml"],
    ["scan.webp", "image/webp"],
    ["favicon.ico", "image/x-icon"],
  ])("maps %s to %s", (path, expected) => {
    expect(contentTypeFor(path)).toBe(expected);
  });

  it("falls back to application/octet-stream for an unknown extension", () => {
    expect(contentTypeFor("data.bin")).toBe("application/octet-stream");
  });

  it("falls back to application/octet-stream for a path with no extension", () => {
    expect(contentTypeFor("noextension")).toBe("application/octet-stream");
  });
});
