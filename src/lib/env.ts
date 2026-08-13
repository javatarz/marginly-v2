/**
 * The only two Supabase settings the Next.js runtime is allowed to know.
 *
 * CODING_STANDARDS.md §1 keeps every secret inside Edge Functions, so the app
 * gets the project URL and the anon key and nothing else. A service key pasted
 * into the anon slot would silently disable RLS for the whole app, so it is
 * refused here rather than trusted.
 */
export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

/** The same two settings, from the process the app is running in. */
export function supabaseEnv(): SupabaseEnv {
  return readSupabaseEnv({
    [URL_VAR]: process.env.NEXT_PUBLIC_SUPABASE_URL,
    [ANON_KEY_VAR]: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function readSupabaseEnv(
  source: Record<string, string | undefined>,
): SupabaseEnv {
  const url = required(source, URL_VAR);
  const anonKey = required(source, ANON_KEY_VAR);

  if (isServiceKey(anonKey)) {
    throw new Error(
      `${ANON_KEY_VAR} holds a service key. The app may only use the anon key; service keys belong to Edge Functions.`,
    );
  }

  return { url, anonKey };
}

function required(
  source: Record<string, string | undefined>,
  name: string,
): string {
  const value = source[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function isServiceKey(key: string): boolean {
  return key.startsWith("sb_secret_") || jwtRole(key) === "service_role";
}

function jwtRole(key: string): string | undefined {
  const payload = key.split(".")[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (typeof claims === "object" && claims !== null && "role" in claims) {
      const role = (claims as { role: unknown }).role;
      return typeof role === "string" ? role : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
