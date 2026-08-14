import { describe, expect, it } from "vitest";

import { canModifyComment, canResolveThread, commentRole } from "./comment-role";

describe("a Comment's writer's role", () => {
  it("is the Author when the writer is the Book's Author", () => {
    expect(commentRole({ bookAuthorId: "author-id", commentAuthorId: "author-id" })).toBe("author");
  });

  it("is a Reviewer when the writer is not the Book's Author", () => {
    expect(commentRole({ bookAuthorId: "author-id", commentAuthorId: "reviewer-id" })).toBe("reviewer");
  });
});

describe("whether to offer Edit/Delete for a Comment", () => {
  it("offers it for the writer's own Comment while the Version is latest", () => {
    expect(
      canModifyComment({ commentAuthorId: "user-1", currentUserId: "user-1", isLatest: true }),
    ).toBe(true);
  });

  it("refuses it for another person's Comment", () => {
    expect(
      canModifyComment({ commentAuthorId: "user-1", currentUserId: "user-2", isLatest: true }),
    ).toBe(false);
  });

  it("refuses it once the Comment's Version is no longer latest", () => {
    expect(
      canModifyComment({ commentAuthorId: "user-1", currentUserId: "user-1", isLatest: false }),
    ).toBe(false);
  });
});

describe("whether to offer Resolve for a Thread", () => {
  it("offers it to the Author on the latest Version of an Open Thread", () => {
    expect(
      canResolveThread({ bookAuthorId: "author-id", currentUserId: "author-id", isLatest: true, resolved: false }),
    ).toBe(true);
  });

  it("refuses it to a Reviewer", () => {
    expect(
      canResolveThread({ bookAuthorId: "author-id", currentUserId: "reviewer-id", isLatest: true, resolved: false }),
    ).toBe(false);
  });

  it("refuses it once the Version is no longer latest", () => {
    expect(
      canResolveThread({ bookAuthorId: "author-id", currentUserId: "author-id", isLatest: false, resolved: false }),
    ).toBe(false);
  });

  it("refuses it once the Thread is already Resolved", () => {
    expect(
      canResolveThread({ bookAuthorId: "author-id", currentUserId: "author-id", isLatest: true, resolved: true }),
    ).toBe(false);
  });
});
