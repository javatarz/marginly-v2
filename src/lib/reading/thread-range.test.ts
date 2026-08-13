import { describe, expect, it } from "vitest";

import { parseTextPosition } from "./thread-range";

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
