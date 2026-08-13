import { describe, expect, it } from "vitest";

import { layoutMargin } from "./margin-layout";

/**
 * ADR-0007/ADR-0014's margin: two Threads never overlap, nudging is downward only, and
 * a crowded Thread keeps the order its position asked for.
 */
describe("layoutMargin", () => {
  it("returns no positions for no Threads", () => {
    expect(layoutMargin([])).toEqual([]);
  });

  it("leaves a lone Thread exactly where it asked to sit", () => {
    const positions = layoutMargin([{ id: "a", naturalTop: 40, height: 20, sequence: 0 }]);
    expect(positions).toEqual([{ id: "a", top: 40 }]);
  });

  it("leaves two Threads with enough room between them untouched", () => {
    const positions = layoutMargin([
      { id: "a", naturalTop: 0, height: 20, sequence: 0 },
      { id: "b", naturalTop: 100, height: 20, sequence: 1 },
    ]);
    expect(positions).toEqual([
      { id: "a", top: 0 },
      { id: "b", top: 100 },
    ]);
  });

  it("nudges a crowded Thread downward only, never upward", () => {
    const positions = layoutMargin([
      { id: "a", naturalTop: 0, height: 50, sequence: 0 },
      { id: "b", naturalTop: 20, height: 50, sequence: 1 },
    ]);

    expect(positions).toEqual([
      { id: "a", top: 0 },
      { id: "b", top: 50 },
    ]);
  });

  it("never lets two Threads overlap", () => {
    const positions = layoutMargin([
      { id: "a", naturalTop: 0, height: 50, sequence: 0 },
      { id: "b", naturalTop: 10, height: 50, sequence: 1 },
      { id: "c", naturalTop: 20, height: 50, sequence: 2 },
    ]);

    for (let i = 1; i < positions.length; i += 1) {
      const previous = positions[i - 1]!;
      const current = positions[i]!;
      expect(current.top).toBeGreaterThanOrEqual(previous.top + 50);
    }
  });

  it("keeps the order positions asked for, even after nudging", () => {
    const positions = layoutMargin([
      { id: "a", naturalTop: 0, height: 50, sequence: 0 },
      { id: "b", naturalTop: 10, height: 50, sequence: 1 },
      { id: "c", naturalTop: 20, height: 50, sequence: 2 },
    ]);

    expect(positions.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("settles the same offset in creation order, oldest first", () => {
    const positions = layoutMargin([
      { id: "second", naturalTop: 50, height: 30, sequence: 2 },
      { id: "first", naturalTop: 50, height: 30, sequence: 1 },
    ]);

    expect(positions.map((p) => p.id)).toEqual(["first", "second"]);
    expect(positions).toEqual([
      { id: "first", top: 50 },
      { id: "second", top: 80 },
    ]);
  });

  it("lands a Thread dropped between two others between them", () => {
    const positions = layoutMargin([
      { id: "a", naturalTop: 0, height: 10, sequence: 0 },
      { id: "c", naturalTop: 100, height: 10, sequence: 2 },
      { id: "b", naturalTop: 50, height: 10, sequence: 1 },
    ]);

    expect(positions.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(positions.find((p) => p.id === "b")?.top).toBe(50);
  });

  it("respects a caller-supplied gap between settled Threads", () => {
    const positions = layoutMargin(
      [
        { id: "a", naturalTop: 0, height: 20, sequence: 0 },
        { id: "b", naturalTop: 10, height: 20, sequence: 1 },
      ],
      5,
    );

    expect(positions).toEqual([
      { id: "a", top: 0 },
      { id: "b", top: 25 },
    ]);
  });
});
