import { SIGNED_IN_HOME } from "@/lib/auth/route-access";

/**
 * Everything that can go wrong creating a Book, in one place — mirrors
 * sign-in-problem.ts, which splits a problem's code from its wording for the same
 * reason: one writer sending a code the dashboard has no wording for.
 */
export const CREATE_BOOK_PROBLEMS = {
  empty: "Enter a name for the Book.",
  // ADR-0008: compared trimmed and case-insensitively, enforced by a unique index
  // rather than by the app alone.
  duplicate: "You already have a Book by that name.",
} as const;

export type CreateBookProblem = keyof typeof CREATE_BOOK_PROBLEMS;

export function createBookProblemMessage(code: string | undefined): string | undefined {
  return code !== undefined && Object.hasOwn(CREATE_BOOK_PROBLEMS, code)
    ? CREATE_BOOK_PROBLEMS[code as CreateBookProblem]
    : undefined;
}

export function dashboardPathWithProblem(problem: CreateBookProblem): string {
  return `${SIGNED_IN_HOME}?bookError=${problem}`;
}
