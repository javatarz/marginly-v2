/**
 * What a magic link is allowed to ask the /auth/confirm route to do.
 *
 * Issue #6 settled the shape: the email carries `{{ .TokenHash }}` rather than the
 * default PKCE `?code=`, so verification is a plain server-side `verifyOtp` with no
 * code verifier held in the requesting browser. The link therefore arrives as query
 * parameters an unauthenticated caller controls, and this decides what to trust.
 *
 * Where a person lands is not one of those parameters. ADR-0011 gives the product two
 * surfaces and every link goes to the dashboard, so there is nothing for a caller to
 * choose — and a chosen destination is how a sign-in link becomes an open redirect.
 */
export type ConfirmRequest =
  | { ok: true; tokenHash: string; type: ConfirmType }
  | { ok: false };

/**
 * The only token type this route verifies. Marginly has no passwords, so nothing
 * issues a recovery token and accepting one would widen the ways in for no caller.
 */
const CONFIRM_TYPE = "email";

export type ConfirmType = typeof CONFIRM_TYPE;

export function readConfirmRequest(params: URLSearchParams): ConfirmRequest {
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (!tokenHash || !isConfirmType(type)) {
    return { ok: false };
  }

  return { ok: true, tokenHash, type };
}

function isConfirmType(value: string | null): value is ConfirmType {
  return value === CONFIRM_TYPE;
}
