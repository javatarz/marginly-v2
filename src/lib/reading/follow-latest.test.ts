import { describe, expect, it } from "vitest";

import { shouldFollowLatestVersion } from "./follow-latest";

describe("shouldFollowLatestVersion", () => {
  it("follows when a new Version lands while the reader was on the previous latest", () => {
    expect(
      shouldFollowLatestVersion({
        currentVersionNumber: 2,
        previousLatestVersionNumber: 2,
        nextLatestVersionNumber: 3,
      }),
    ).toBe(true);
  });

  it("does not follow when the reader had switched away to an older Version", () => {
    expect(
      shouldFollowLatestVersion({
        currentVersionNumber: 1,
        previousLatestVersionNumber: 2,
        nextLatestVersionNumber: 3,
      }),
    ).toBe(false);
  });

  it("does not follow when the latest Version number has not changed", () => {
    expect(
      shouldFollowLatestVersion({
        currentVersionNumber: 2,
        previousLatestVersionNumber: 2,
        nextLatestVersionNumber: 2,
      }),
    ).toBe(false);
  });
});
