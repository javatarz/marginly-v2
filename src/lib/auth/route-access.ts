/**
 * Whether a request may proceed, and where it goes instead.
 *
 * Everything in Marginly is behind sign-in: ADR-0011 gives the product two surfaces,
 * a dashboard and a Book page, and neither has a signed-out form. Only the two routes
 * that exist to *get* a person signed in are public.
 *
 * This is the decision alone. The middleware supplies the session and performs the
 * redirect; keeping the rule here is what lets every branch of it be tested without
 * a request.
 */
export type RouteAccess = { allow: true } | { allow: false; redirectTo: string };

export type RouteRequest = {
  path: string;
  signedIn: boolean;
};

export const SIGN_IN_PATH = "/sign-in";
export const CONFIRM_PATH = "/auth/confirm";
export const SIGNED_IN_HOME = "/";

const PUBLIC_PATHS: readonly string[] = [SIGN_IN_PATH, CONFIRM_PATH];

export function decideRouteAccess({ path, signedIn }: RouteRequest): RouteAccess {
  if (signedIn) {
    // A signed-in person on the sign-in page would otherwise be able to spend a
    // magic-link email they do not need, out of a budget of two an hour (issue #6).
    return path === SIGN_IN_PATH
      ? { allow: false, redirectTo: SIGNED_IN_HOME }
      : { allow: true };
  }

  return PUBLIC_PATHS.includes(path)
    ? { allow: true }
    : { allow: false, redirectTo: SIGN_IN_PATH };
}
