import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

const { GET } = await import("./route");

const requestWithHost = (host: string, query: string) =>
  new NextRequest(
    new Request(`http://localhost:3000/auth/confirm${query}`, {
      headers: { host },
    }),
  );

beforeEach(() => {
  verifyOtp.mockReset();
});

describe("redirecting after a magic link", () => {
  it("redirects a malformed link to the request's real host, not nextUrl's baked-in host", async () => {
    const request = requestWithHost("127.0.0.1:3000", "?type=email");

    const response = await GET(request);

    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/sign-in?error=link",
    );
  });

  it("redirects a verified link to the request's real host, not nextUrl's baked-in host", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const request = requestWithHost(
      "127.0.0.1:3000",
      "?token_hash=abc123&type=email",
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
  });
});
