import { describe, expect, it } from "vitest";

import { decideRouteAccess } from "./route-access";

describe("deciding who may reach a route", () => {
  it("lets a signed-in person through", () => {
    expect(decideRouteAccess({ path: "/", signedIn: true })).toEqual({
      allow: true,
    });
  });

  it("sends a signed-out person to sign in", () => {
    expect(decideRouteAccess({ path: "/", signedIn: false })).toEqual({
      allow: false,
      redirectTo: "/sign-in",
    });
  });

  it("sends a signed-out person to sign in from any other route", () => {
    expect(decideRouteAccess({ path: "/books/7", signedIn: false })).toEqual({
      allow: false,
      redirectTo: "/sign-in",
    });
  });

  it("lets a signed-out person reach the sign-in page", () => {
    expect(decideRouteAccess({ path: "/sign-in", signedIn: false })).toEqual({
      allow: true,
    });
  });

  // The confirm route is how a signed-out person becomes signed in, so gating it
  // would make every magic link a redirect back to sign-in.
  it("lets a signed-out person reach the confirm route", () => {
    expect(decideRouteAccess({ path: "/auth/confirm", signedIn: false })).toEqual({
      allow: true,
    });
  });

  it("sends a signed-in person away from the sign-in page", () => {
    expect(decideRouteAccess({ path: "/sign-in", signedIn: true })).toEqual({
      allow: false,
      redirectTo: "/",
    });
  });

  it("leaves a signed-in person on the confirm route", () => {
    expect(decideRouteAccess({ path: "/auth/confirm", signedIn: true })).toEqual({
      allow: true,
    });
  });

  it("treats a path that only looks public as private", () => {
    expect(decideRouteAccess({ path: "/sign-inx", signedIn: false })).toEqual({
      allow: false,
      redirectTo: "/sign-in",
    });
  });
});
