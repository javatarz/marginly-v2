/**
 * The identity a raw Postgres connection has to reproduce by hand.
 *
 * ADR-0009: the platform gateway verifies a deployed Function's JWT before its body
 * ever runs, so the claims are trustworthy by the time they reach here — this decodes
 * the payload segment without checking the signature again, and reads only `sub`, the
 * one claim `auth.uid()` looks at.
 */
export type BearerClaims = {
  readonly sub: string;
};

const BEARER = /^Bearer (.+)$/;

export function decodeBearerClaims(
  authorization: string | null,
): BearerClaims | null {
  const match = authorization === null ? null : BEARER.exec(authorization);
  if (match === null) {
    return null;
  }

  const payload = match[1].split(".")[1];
  if (payload === undefined) {
    return null;
  }

  let claims: unknown;
  try {
    claims = JSON.parse(decodeBase64Url(payload));
  } catch {
    return null;
  }

  if (
    typeof claims !== "object" || claims === null ||
    typeof (claims as { sub?: unknown }).sub !== "string"
  ) {
    return null;
  }

  return { sub: (claims as { sub: string }).sub };
}

function decodeBase64Url(segment: string): string {
  const padding = (4 - (segment.length % 4)) % 4;
  const base64 = segment.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat(padding);
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
