import { describe, expect, it } from "vitest";

import { describeUploadError } from "./upload-response";

describe("describing why an Upload failed", () => {
  it("reads the message off the Function's error response", async () => {
    const error = { context: new Response(JSON.stringify({ message: "Refused." })) };

    expect(await describeUploadError(error)).toBe("Refused.");
  });

  it("falls back when the error carries no Response context", async () => {
    expect(await describeUploadError(new Error("network down"))).toBe(
      "Could not create the Version. Try again.",
    );
  });

  it("falls back when the error is not an object at all", async () => {
    expect(await describeUploadError("boom")).toBe(
      "Could not create the Version. Try again.",
    );
  });

  it("falls back when the response body is not JSON", async () => {
    const error = { context: new Response("not json") };

    expect(await describeUploadError(error)).toBe(
      "Could not create the Version. Try again.",
    );
  });

  it("falls back when the response body carries no message", async () => {
    const error = { context: new Response(JSON.stringify({ ok: false })) };

    expect(await describeUploadError(error)).toBe(
      "Could not create the Version. Try again.",
    );
  });
});
