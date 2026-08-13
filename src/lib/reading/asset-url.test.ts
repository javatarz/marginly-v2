import { describe, expect, it } from "vitest";

import { assetUrl } from "./asset-url";

describe("assetUrl", () => {
  it("builds the access-checked asset route for a plain relative path", () => {
    expect(assetUrl("book-1", 3, "fig1.png")).toBe(
      "/books/book-1/versions/3/assets/fig1.png",
    );
  });

  it("encodes each path segment on its own, leaving the slashes between them alone", () => {
    expect(assetUrl("book-1", 3, "images/fig 1.png")).toBe(
      "/books/book-1/versions/3/assets/images/fig%201.png",
    );
  });
});
