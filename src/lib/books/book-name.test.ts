import { describe, expect, it } from "vitest";

import { validateBookName } from "./book-name";

describe("a Book's name at create", () => {
  it("accepts a name and keeps it exactly as typed", () => {
    expect(validateBookName("  My Book  ")).toEqual({ ok: true, name: "  My Book  " });
  });

  it("refuses an empty name", () => {
    expect(validateBookName("")).toEqual({ ok: false });
  });

  it("refuses a whitespace-only name", () => {
    expect(validateBookName("   ")).toEqual({ ok: false });
  });
});
