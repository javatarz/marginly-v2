import { describe, expect, it } from "vitest";

import { signInPathWithProblem, signInProblemMessage } from "./sign-in-problem";

describe("what the sign-in page says went wrong", () => {
  it("has wording for every problem a caller can send", () => {
    expect(signInProblemMessage("rate")).toBe(
      "Too many sign-in emails just now. Try again shortly.",
    );
  });

  it("says nothing when nothing went wrong", () => {
    expect(signInProblemMessage(undefined)).toBeUndefined();
  });

  it("says nothing for a code it does not know", () => {
    expect(signInProblemMessage("something-else")).toBeUndefined();
  });

  // `in` would have answered with Object.prototype's own members here, handing the page
  // a function to render.
  it("says nothing for a name it inherits rather than holds", () => {
    expect(signInProblemMessage("toString")).toBeUndefined();
    expect(signInProblemMessage("constructor")).toBeUndefined();
  });

  it("builds the path a failed sign-in comes back to", () => {
    expect(signInPathWithProblem("link")).toBe("/sign-in?error=link");
  });
});
