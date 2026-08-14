import { describe, expect, it } from "vitest";

import { nextSelectedThreadId } from "./next-selected-thread";

describe("which Thread stays selected after a mutation", () => {
  it("keeps the current selection when its Thread is still there", () => {
    expect(nextSelectedThreadId("thread-1", [{ threadId: "thread-1" }, { threadId: "thread-2" }])).toBe(
      "thread-1",
    );
  });

  it("clears the selection when its Thread has been deleted", () => {
    expect(nextSelectedThreadId("thread-1", [{ threadId: "thread-2" }])).toBeNull();
  });

  it("stays null when nothing was selected", () => {
    expect(nextSelectedThreadId(null, [{ threadId: "thread-1" }])).toBeNull();
  });
});
