import { describe, expect, it } from "vitest";

import { displayNameFromEmail } from "./display-name";

describe("displayNameFromEmail", () => {
  it("takes the local part before the @, capitalised", () => {
    expect(displayNameFromEmail("annie@gmail.com")).toBe("Annie");
  });

  it("takes the local part for a different domain", () => {
    expect(displayNameFromEmail("gaurav@abc.in")).toBe("Gaurav");
  });

  it("falls back to the whole string, capitalised, when there is no @", () => {
    expect(displayNameFromEmail("annie")).toBe("Annie");
  });

  it("falls back to the whole string for an empty email", () => {
    expect(displayNameFromEmail("")).toBe("");
  });

  it("leaves an already-capitalised local part unchanged", () => {
    expect(displayNameFromEmail("Annie@gmail.com")).toBe("Annie");
  });
});
