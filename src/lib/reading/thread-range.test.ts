import { describe, expect, it } from "vitest";

import { formatTextPosition, parseTextPosition, parseThreadStatus } from "./thread-range";

describe("parseTextPosition", () => {
  it("parses a canonical int4range", () => {
    expect(parseTextPosition("[0,5)")).toEqual([0, 5]);
  });

  it("parses bounds with more than one digit", () => {
    expect(parseTextPosition("[120,340)")).toEqual([120, 340]);
  });

  it("throws on a non-canonical form", () => {
    expect(() => parseTextPosition("empty")).toThrow();
  });
});

describe("formatTextPosition", () => {
  it("formats the same canonical form parseTextPosition parses", () => {
    expect(formatTextPosition(0, 5)).toBe("[0,5)");
    expect(parseTextPosition(formatTextPosition(120, 340))).toEqual([120, 340]);
  });
});

describe("parseThreadStatus", () => {
  it("accepts linked", () => {
    expect(parseThreadStatus("linked")).toBe("linked");
  });

  it("accepts unlinked", () => {
    expect(parseThreadStatus("unlinked")).toBe("unlinked");
  });

  it("throws on anything else", () => {
    expect(() => parseThreadStatus("resolved")).toThrow();
  });
});
