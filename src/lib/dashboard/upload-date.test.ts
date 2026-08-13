import { describe, expect, it } from "vitest";

import { formatUploadDate } from "./upload-date";

describe("formatting an Upload's instant as a date", () => {
  // The instant that showed the original bug: past 23:30 UTC, but only 09:00 in a zone
  // five and a half hours ahead — the two zones must disagree on the calendar day.
  const NEAR_MIDNIGHT_UTC = "2026-08-13T23:30:00Z";

  it("reads by the named zone, not by the instant's own UTC day", () => {
    expect(formatUploadDate(NEAR_MIDNIGHT_UTC, "UTC")).toBe("13 Aug 2026");
    expect(formatUploadDate(NEAR_MIDNIGHT_UTC, "Asia/Kolkata")).toBe("14 Aug 2026");
  });

  it("falls back to the runtime's own zone when none is named", () => {
    const withoutZone = formatUploadDate(NEAR_MIDNIGHT_UTC);
    const withRuntimeZone = formatUploadDate(NEAR_MIDNIGHT_UTC, Intl.DateTimeFormat().resolvedOptions().timeZone);

    expect(withoutZone).toBe(withRuntimeZone);
  });
});
