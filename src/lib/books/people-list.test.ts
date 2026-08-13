import { describe, expect, it } from "vitest";

import { peopleList } from "./people-list";

describe("the People panel's list", () => {
  it("puts the Author first, regardless of where their address sorts", () => {
    expect(
      peopleList({
        authorId: "author-id",
        authorEmail: "zzz-author@example.com",
        reviewers: [{ id: "reviewer-id", email: "aaa-reviewer@example.com" }],
      }),
    ).toEqual([
      { id: "author-id", email: "zzz-author@example.com", role: "author" },
      { id: "reviewer-id", email: "aaa-reviewer@example.com", role: "reviewer" },
    ]);
  });

  it("orders Reviewers by address", () => {
    const result = peopleList({
      authorId: "author-id",
      authorEmail: "author@example.com",
      reviewers: [
        { id: "b-id", email: "bravo@example.com" },
        { id: "a-id", email: "alpha@example.com" },
      ],
    });

    expect(result.map((person) => person.email)).toEqual([
      "author@example.com",
      "alpha@example.com",
      "bravo@example.com",
    ]);
  });

  it("is just the Author when nobody has been granted access", () => {
    expect(
      peopleList({ authorId: "author-id", authorEmail: "author@example.com", reviewers: [] }),
    ).toEqual([{ id: "author-id", email: "author@example.com", role: "author" }]);
  });
});
