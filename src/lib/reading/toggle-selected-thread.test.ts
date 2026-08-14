import { describe, expect, it } from "vitest";

import { toggleSelectedThreadId } from "./toggle-selected-thread";

describe("toggling a Thread's selection on click", () => {
  it("selects a Thread that was not already selected", () => {
    expect(toggleSelectedThreadId(null, "thread-1")).toBe("thread-1");
    expect(toggleSelectedThreadId("thread-2", "thread-1")).toBe("thread-1");
  });

  it("deselects a Thread that was already selected", () => {
    expect(toggleSelectedThreadId("thread-1", "thread-1")).toBeNull();
  });
});
