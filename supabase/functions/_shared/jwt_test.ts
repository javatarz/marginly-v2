import { assertEquals } from "@std/assert";

import { decodeBearerClaims } from "./jwt.ts";

function tokenFor(payload: unknown): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.signature-not-checked-here`;
}

function base64Url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

Deno.test("reads the sub out of a Bearer token's claims", () => {
  const authorization = `Bearer ${tokenFor({ sub: "author-1", role: "authenticated" })}`;

  assertEquals(decodeBearerClaims(authorization), { sub: "author-1" });
});

Deno.test("returns null when there is no Authorization header", () => {
  assertEquals(decodeBearerClaims(null), null);
});

Deno.test("returns null when the header does not carry a Bearer token", () => {
  assertEquals(decodeBearerClaims("Basic dXNlcjpwYXNz"), null);
});

Deno.test("returns null when the token has no payload segment", () => {
  assertEquals(decodeBearerClaims("Bearer only-one-segment"), null);
});

Deno.test("returns null when the payload is not valid JSON", () => {
  const authorization = `Bearer header.${base64Url("not json")}.sig`;

  assertEquals(decodeBearerClaims(authorization), null);
});

Deno.test("returns null when the claims carry no sub", () => {
  const authorization = `Bearer ${tokenFor({ role: "authenticated" })}`;

  assertEquals(decodeBearerClaims(authorization), null);
});

Deno.test("returns null when the claims are not a JSON object", () => {
  const authorization = `Bearer ${tokenFor("just a string")}`;

  assertEquals(decodeBearerClaims(authorization), null);
});
