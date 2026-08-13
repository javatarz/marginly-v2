/**
 * What the `upload` Edge Function's response means to the Author, on both of the
 * paths supabase-js gives a Function call: a normal `{ok, ...}` body, and a non-2xx
 * status, whose body reaches the caller only through the thrown error's `context`
 * (a `Response`) rather than through `data` (ADR-0015: the Function answers what the
 * Author confirms, and a refusal is still something to show them, not a blank error).
 */
export type UploadOutcome =
  | { readonly ok: true; readonly versionNumber: number }
  | { readonly ok: false; readonly message: string };

const FALLBACK_MESSAGE = "Could not create the Version. Try again.";

export async function describeUploadError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) {
    return FALLBACK_MESSAGE;
  }

  try {
    const body: unknown = await context.clone().json();
    const message = (body as { message?: unknown } | null)?.message;
    return typeof message === "string" ? message : FALLBACK_MESSAGE;
  } catch {
    return FALLBACK_MESSAGE;
  }
}
