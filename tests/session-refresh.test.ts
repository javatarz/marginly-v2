import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

import { refreshSession } from "@/lib/supabase/middleware";

import { sessionCookies, useLocalStackEnv } from "./support/local-stack";

/**
 * The middleware's wiring, against the real stack.
 *
 * ADR-0013 gives adapters wiring tests and nothing more, and this one is worth having:
 * the refresh is what keeps a session alive, and a session terminated early is spent as
 * a magic-link email out of a budget of two an hour (issue #6). The pure decision it
 * defers to is tested separately in src/lib/auth/route-access.test.ts.
 */
describe("the session refresh in middleware", () => {
  const person = "refresh-person@example.com";
  let cookies: { name: string; value: string }[];

  beforeAll(async () => {
    useLocalStackEnv();
    cookies = await sessionCookies(person);
  }, 60_000);

  // Next normalises the host of a cloned request URL, so the rule under test is the
  // path it sends a person to, not the origin it rebuilds.
  const redirectPath = (response: Response) => {
    const location = response.headers.get("location");
    return location === null ? null : new URL(location).pathname;
  };

  const requestFor = (path: string, withCookies: typeof cookies) => {
    const request = new NextRequest(`http://127.0.0.1:3000${path}`);
    for (const { name, value } of withCookies) {
      request.cookies.set(name, value);
    }
    return request;
  };

  it("lets a signed-in request through", async () => {
    const response = await refreshSession(requestFor("/", cookies));

    expect(response.status).toBe(200);
    expect(redirectPath(response)).toBeNull();
  });

  it("turns a signed-out request away to sign in", async () => {
    const response = await refreshSession(requestFor("/", []));

    expect(response.status).toBe(307);
    expect(redirectPath(response)).toBe("/sign-in");
  });

  it("leaves a signed-out request on the sign-in page", async () => {
    const response = await refreshSession(requestFor("/sign-in", []));

    expect(response.status).toBe(200);
  });

  it("sends a signed-in request away from the sign-in page", async () => {
    const response = await refreshSession(requestFor("/sign-in", cookies));

    expect(response.status).toBe(307);
    expect(redirectPath(response)).toBe("/");
  });

  // A stale cookie is what a session that has been signed out elsewhere looks like.
  it("treats an unreadable session cookie as signed out", async () => {
    const tampered = cookies.map(({ name, value }) => ({
      name,
      value: `${value.slice(0, -4)}0000`,
    }));

    const response = await refreshSession(requestFor("/", tampered));

    expect(response.status).toBe(307);
    expect(redirectPath(response)).toBe("/sign-in");
  });
});
