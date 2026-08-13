import { describe, expect, it } from "vitest";

import {
  bookPathWithGrantProblem,
  grantAccessProblemFromErrorCode,
  grantAccessProblemMessage,
} from "./grant-access-problem";

describe("what a Book's People panel says went wrong granting access", () => {
  it("maps grant_access's error codes to a problem", () => {
    expect(grantAccessProblemFromErrorCode("MG001")).toBe("noAccount");
    expect(grantAccessProblemFromErrorCode("MG002")).toBe("noVersions");
    expect(grantAccessProblemFromErrorCode("MG003")).toBe("alreadyGranted");
    expect(grantAccessProblemFromErrorCode("MG004")).toBe("selfGrant");
  });

  it("recognises no problem in a code it does not name", () => {
    expect(grantAccessProblemFromErrorCode("MG000")).toBeUndefined();
    expect(grantAccessProblemFromErrorCode(undefined)).toBeUndefined();
    expect(grantAccessProblemFromErrorCode(null)).toBeUndefined();
  });

  it("has wording for every problem it can map to", () => {
    expect(grantAccessProblemMessage("noAccount")).toBe("No account holds that address.");
    expect(grantAccessProblemMessage("noVersions")).toBe(
      "Upload the first Version before granting access.",
    );
    expect(grantAccessProblemMessage("alreadyGranted")).toBe("That address already has access.");
    expect(grantAccessProblemMessage("selfGrant")).toBe("You already have access as the Author.");
  });

  it("has no wording for a code it does not recognise", () => {
    expect(grantAccessProblemMessage("something-else")).toBeUndefined();
    expect(grantAccessProblemMessage(undefined)).toBeUndefined();
  });

  it("builds the path a failed grant comes back to", () => {
    expect(bookPathWithGrantProblem("a-book-id", "noAccount")).toBe(
      "/books/a-book-id?peopleError=noAccount",
    );
  });
});
