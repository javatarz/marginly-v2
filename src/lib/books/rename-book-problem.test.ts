import { describe, expect, it } from "vitest";

import { bookPathWithRenameProblem, renameBookProblemMessage } from "./rename-book-problem";

describe("what a Book's page says went wrong renaming it", () => {
  it("reuses create's wording for the same problem codes", () => {
    expect(renameBookProblemMessage("empty")).toBe("Enter a name for the Book.");
    expect(renameBookProblemMessage("duplicate")).toBe(
      "You already have a Book by that name.",
    );
  });

  it("builds the path a failed rename comes back to", () => {
    expect(bookPathWithRenameProblem("a-book-id", "duplicate")).toBe(
      "/books/a-book-id?renameError=duplicate",
    );
  });
});
