import { describe, expect, it } from "vitest";

import { mergeIntervals } from "./union-intervals";

/**
 * ADR-0007: every Linked Thread's range is merged into a union interval set before
 * drawing, so overlap and nesting leave no trace in the uniform shading.
 */
describe("mergeIntervals", () => {
  it("returns an empty set for no ranges", () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it("returns a single range unchanged", () => {
    expect(mergeIntervals([[3, 7]])).toEqual([[3, 7]]);
  });

  it("keeps two disjoint ranges apart", () => {
    expect(mergeIntervals([[0, 2], [5, 8]])).toEqual([[0, 2], [5, 8]]);
  });

  it("merges two overlapping ranges into one", () => {
    expect(mergeIntervals([[0, 5], [3, 8]])).toEqual([[0, 8]]);
  });

  it("merges a range nested entirely inside another, leaving no trace of it", () => {
    expect(mergeIntervals([[0, 10], [3, 5]])).toEqual([[0, 10]]);
  });

  it("merges two ranges that touch exactly at an endpoint", () => {
    expect(mergeIntervals([[0, 5], [5, 8]])).toEqual([[0, 8]]);
  });

  it("sorts unordered input before merging", () => {
    expect(mergeIntervals([[5, 8], [0, 5]])).toEqual([[0, 8]]);
  });

  it("merges a chain of three overlapping ranges into one", () => {
    expect(mergeIntervals([[0, 4], [3, 6], [5, 9]])).toEqual([[0, 9]]);
  });

  it("leaves ranges given out of order and non-overlapping as separate, sorted", () => {
    expect(mergeIntervals([[10, 12], [0, 2], [5, 7]])).toEqual([
      [0, 2],
      [5, 7],
      [10, 12],
    ]);
  });
});
