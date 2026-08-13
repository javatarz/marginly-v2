import { describe, expect, it } from "vitest";

import { readConfirmRequest } from "./confirm-request";

const params = (query: string) =>
  new URL(`http://x/auth/confirm${query}`).searchParams;

describe("reading a magic link's confirm request", () => {
  it("takes the token hash and the type from the link", () => {
    expect(readConfirmRequest(params("?token_hash=abc123&type=email"))).toEqual({
      ok: true,
      tokenHash: "abc123",
      type: "email",
    });
  });

  it("refuses a recovery token — nothing in Marginly issues one", () => {
    expect(
      readConfirmRequest(params("?token_hash=abc123&type=recovery")),
    ).toEqual({ ok: false });
  });

  it("refuses a link with no token hash", () => {
    expect(readConfirmRequest(params("?type=email"))).toEqual({ ok: false });
  });

  it("refuses an empty token hash", () => {
    expect(readConfirmRequest(params("?token_hash=&type=email"))).toEqual({
      ok: false,
    });
  });

  it("refuses a link with no type", () => {
    expect(readConfirmRequest(params("?token_hash=abc123"))).toEqual({
      ok: false,
    });
  });

  it("refuses a type it does not verify", () => {
    expect(readConfirmRequest(params("?token_hash=abc123&type=signup"))).toEqual({
      ok: false,
    });
  });
});
