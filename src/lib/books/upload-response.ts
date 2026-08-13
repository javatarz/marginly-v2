/**
 * What the `upload-preview` and `upload-confirm` Edge Functions' responses mean to the
 * Author, on both of the paths supabase-js gives a Function call: a normal `{ok, ...}`
 * body, and a non-2xx status, whose body reaches the caller only through the thrown
 * error's `context` (a `Response`) rather than through `data` (ADR-0015: a refusal is
 * still something to show the Author, not a blank error).
 */
export type PreviewOutcome =
  | {
    readonly ok: true;
    readonly bookName: string;
    readonly segments: readonly string[];
    readonly removedTagCount: number;
  }
  | { readonly ok: false; readonly message: string };

export type ConfirmOutcome =
  | { readonly ok: true; readonly versionNumber: number }
  | { readonly ok: false; readonly message: string };

const FALLBACK_MESSAGE = "Could not complete the Upload. Try again.";

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
