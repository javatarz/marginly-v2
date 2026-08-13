/**
 * Everything that can go wrong granting a Reviewer access (#28), mirroring
 * create-book-problem.ts: a problem's code is split from its wording so one writer
 * cannot send a code the People panel has no message for.
 *
 * `grant_access` names its refusals with a custom Postgres error code
 * (20260814020000_grant_and_revoke_access.sql) rather than message text, so a wording
 * change there can never silently stop the app recognising which refusal fired.
 */
export const GRANT_ACCESS_PROBLEMS = {
  noAccount: "No account holds that address.",
  noVersions: "Upload the first Version before granting access.",
  alreadyGranted: "That address already has access.",
  selfGrant: "You already have access as the Author.",
} as const;

export type GrantAccessProblem = keyof typeof GRANT_ACCESS_PROBLEMS;

const ERROR_CODE_TO_PROBLEM: Record<string, GrantAccessProblem> = {
  MG001: "noAccount",
  MG002: "noVersions",
  MG003: "alreadyGranted",
  MG004: "selfGrant",
};

export function grantAccessProblemFromErrorCode(
  code: string | null | undefined,
): GrantAccessProblem | undefined {
  return code ? ERROR_CODE_TO_PROBLEM[code] : undefined;
}

export function grantAccessProblemMessage(code: string | undefined): string | undefined {
  return code !== undefined && Object.hasOwn(GRANT_ACCESS_PROBLEMS, code)
    ? GRANT_ACCESS_PROBLEMS[code as GrantAccessProblem]
    : undefined;
}

export function bookPathWithGrantProblem(bookId: string, problem: GrantAccessProblem): string {
  return `/books/${bookId}?peopleError=${problem}`;
}
