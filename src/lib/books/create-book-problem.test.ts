import { describe, expect, it } from "vitest";

import { createBookProblemMessage, dashboardPathWithProblem } from "./create-book-problem";

describe("what the dashboard says went wrong creating a Book", () => {
  it("has wording for every problem a caller can send", () => {
    expect(createBookProblemMessage("empty")).toBe("Enter a name for the Book.");
    expect(createBookProblemMessage("duplicate")).toBe(
      "You already have a Book by that name.",
    );
  });

  it("says nothing when nothing went wrong", () => {
    expect(createBookProblemMessage(undefined)).toBeUndefined();
  });

  it("says nothing for a code it does not know", () => {
    expect(createBookProblemMessage("something-else")).toBeUndefined();
  });

  // `in` would have answered with Object.prototype's own members here, handing the page
  // a function to render.
  it("says nothing for a name it inherits rather than holds", () => {
    expect(createBookProblemMessage("toString")).toBeUndefined();
    expect(createBookProblemMessage("constructor")).toBeUndefined();
  });

  it("builds the path a failed create comes back to", () => {
    expect(dashboardPathWithProblem("duplicate")).toBe("/?bookError=duplicate");
  });
});
