import { afterEach, describe, expect, it } from "vitest";

import { readSupabaseEnv, supabaseEnv } from "./env";

const jwtWithRole = (role: string) => {
  const segment = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "HS256", typ: "JWT" })}.${segment({ role })}.signature`;
};

const anonJwt = jwtWithRole("anon");

describe("reading the Supabase environment from the process", () => {
  const before = { ...process.env };

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = before.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = before.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("takes both settings from the environment the app runs in", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonJwt;

    expect(supabaseEnv()).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: anonJwt,
    });
  });

  it("refuses a service key put there instead", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwtWithRole("service_role");

    expect(() => supabaseEnv()).toThrow("holds a service key");
  });
});

describe("reading the Supabase environment", () => {
  it("returns the project URL and the anon key", () => {
    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt,
      }),
    ).toEqual({ url: "http://127.0.0.1:54321", anonKey: anonJwt });
  });

  it("accepts a publishable key alongside the legacy JWT form", () => {
    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc123",
      }).anonKey,
    ).toBe("sb_publishable_abc123");
  });

  it("accepts an opaque key it cannot recognise either way", () => {
    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "opaque",
      }).anonKey,
    ).toBe("opaque");
  });

  it("names a missing URL", () => {
    expect(() =>
      readSupabaseEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_URL is not set");
  });

  it("names a missing anon key", () => {
    expect(() =>
      readSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  });

  it("treats a blank value as missing", () => {
    expect(() =>
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "   ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt,
      }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_URL is not set");
  });

  it("refuses a service_role JWT in the anon slot", () => {
    expect(() =>
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole("service_role"),
      }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY holds a service key");
  });

  it("refuses a secret key in the anon slot", () => {
    expect(() =>
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc123",
      }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY holds a service key");
  });

  it("ignores a JWT-shaped key whose payload is not readable", () => {
    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "header.@@notbase64@@.signature",
      }).anonKey,
    ).toBe("header.@@notbase64@@.signature");
  });

  it("accepts a JWT whose payload carries no role", () => {
    const roleless = `header.${Buffer.from(JSON.stringify({ iss: "supabase" })).toString("base64url")}.signature`;

    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: roleless,
      }).anonKey,
    ).toBe(roleless);
  });

  it("accepts a JWT whose role claim is not a string", () => {
    const oddRole = `header.${Buffer.from(JSON.stringify({ role: 7 })).toString("base64url")}.signature`;

    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: oddRole,
      }).anonKey,
    ).toBe(oddRole);
  });

  it("accepts a JWT whose payload is not an object", () => {
    const notObject = `header.${Buffer.from("42").toString("base64url")}.signature`;

    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: notObject,
      }).anonKey,
    ).toBe(notObject);
  });

  it("trims the values it returns", () => {
    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: " http://127.0.0.1:54321 ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ` ${anonJwt} `,
      }),
    ).toEqual({ url: "http://127.0.0.1:54321", anonKey: anonJwt });
  });
});
