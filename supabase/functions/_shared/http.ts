/**
 * The response shapes every Edge Function answers in.
 *
 * ADR-0013 keeps this module inside Deno: nothing under `supabase/functions/`
 * is imported by the Next.js app, and nothing here imports from it.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
