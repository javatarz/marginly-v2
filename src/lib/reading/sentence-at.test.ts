import { describe, expect, it } from "vitest";

import { sentenceRange } from "./sentence-at";

describe("sentenceRange", () => {
  it("returns the one sentence when there is only one", () => {
    expect(sentenceRange("Hello world.", 3)).toEqual([0, 12]);
  });

  it("returns the sentence the offset falls inside, among several", () => {
    expect(sentenceRange("Hi. Bye.", 5)).toEqual([4, 8]);
  });

  it("assigns the boundary offset right after a terminator to the sentence before it", () => {
    expect(sentenceRange("Hi. Bye.", 3)).toEqual([0, 3]);
  });

  it("assigns the offset right after the separating space to the sentence after it", () => {
    expect(sentenceRange("Hi. Bye.", 4)).toEqual([4, 8]);
  });

  it("treats the whole text as one sentence when it holds no terminator", () => {
    expect(sentenceRange("no punctuation here", 4)).toEqual([0, 19]);
  });

  it("clamps a negative offset to the text's start", () => {
    expect(sentenceRange("Hello.", -5)).toEqual([0, 6]);
  });

  it("clamps an offset past the text's end to the text's own length", () => {
    expect(sentenceRange("Hello.", 999)).toEqual([0, 6]);
  });

  it("falls back to the whole (empty) range on empty text", () => {
    expect(sentenceRange("", 0)).toEqual([0, 0]);
  });

  it("falls back to the last sentence when the offset lands past trailing whitespace with no terminator", () => {
    expect(sentenceRange("Hi. Bye. extra  ", 999)).toEqual([9, 14]);
  });
});
