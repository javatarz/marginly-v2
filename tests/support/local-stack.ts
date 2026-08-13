import { execFileSync } from "node:child_process";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * The local stack, as the integration tests see it.
 *
 * These tests set up their own pre-state. Nothing here is read from the shell or from
 * a .env file: the stack's own URL and anon key come from the CLI, and accounts are
 * created by running the seed script — which stays the only holder of the service_role
 * key (ADR-0010). A test that depended on an exported value would pass or fail on what
 * the operator happened to have in their environment.
 */
type Status = { API_URL: string; ANON_KEY: string };

let cached: Status | undefined;

function status(): Status {
  cached ??= JSON.parse(
    execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }),
  ) as Status;
  return cached;
}

/** A client holding the anon key and no session — what an unauthenticated caller has. */
export function anonClient(): SupabaseClient<Database> {
  const { API_URL, ANON_KEY } = status();
  return createClient<Database>(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Create the account if it is not there, then sign it in and return a client holding
 * its session. The sign-in runs the real token-hash path — `generateLink` then
 * `verifyOtp` — so it costs no email out of the mailer's two-an-hour budget.
 */
export async function signedInClient(email: string): Promise<SupabaseClient<Database>> {
  seed(email);
  const tokenHash = mintTokenHash(email);

  const client = anonClient();
  const { error } = await client.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });

  if (error) {
    throw new Error(`could not sign in ${email}: ${error.message}`);
  }

  return client;
}

/**
 * Point the code under test at the local stack. The middleware reads its settings from
 * the process, and a test that relied on them being exported already would pass or fail
 * on the operator's shell.
 */
export function useLocalStackEnv(): void {
  const { API_URL, ANON_KEY } = status();
  process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
}

/**
 * The cookies a browser would be holding after this account signed in. Produced by
 * @supabase/ssr itself rather than hand-rolled, so the test cannot drift from the cookie
 * format the middleware reads.
 */
export async function sessionCookies(
  email: string,
): Promise<{ name: string; value: string }[]> {
  seed(email);
  const tokenHash = mintTokenHash(email);
  const { API_URL, ANON_KEY } = status();

  const written: { name: string; value: string }[] = [];
  const client = createServerClient<Database>(API_URL, ANON_KEY, {
    cookies: {
      getAll: () => written.map(({ name, value }) => ({ name, value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          written.push({ name, value });
        }
      },
    },
  });

  const { error } = await client.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });

  if (error) {
    throw new Error(`could not sign in ${email}: ${error.message}`);
  }

  return written;
}

export function accountId(client: SupabaseClient<Database>): Promise<string> {
  return client.auth.getUser().then(({ data }) => {
    if (!data.user) {
      throw new Error("client holds no session");
    }
    return data.user.id;
  });
}

function seed(email: string): void {
  runSeedScript([email]);
}

function mintTokenHash(email: string): string {
  const output = runSeedScript(["--link", email]);
  const hash = output.trim().split(/\s+/).at(-1);

  if (!hash) {
    throw new Error(`no token hash for ${email}: ${output}`);
  }

  return hash;
}

function runSeedScript(args: string[]): string {
  return execFileSync(
    "node",
    ["scripts/seed-accounts.mjs", "--local", ...args],
    { encoding: "utf8" },
  );
}
