import { describe, expect, it } from "vitest";

import { canModifyComment, commentRole } from "./comment-role";

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
