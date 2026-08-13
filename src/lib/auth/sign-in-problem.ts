import { SIGN_IN_PATH } from "./route-access";

/**
 * Everything that can go wrong on the way in, in one place.
 *
 * Three writers put a person back on the sign-in page — the form's action, the confirm
 * route, and the middleware — and the page has to say something for each. Splitting the
 * codes from their wording is how one of them ends up sending a code nothing renders.
 */
export const SIGN_IN_PROBLEMS = {
  email: "Enter your email address.",
  rate: "Too many sign-in emails just now. Try again shortly.",
  // Expired, already used, opened in another browser, or malformed. Supabase's advice
  // for every one of them is the same, and telling them apart leaks account state
  // (issue #6).
  link: "That sign-in link did not work. Ask for a new one.",
} as const;

export type SignInProblem = keyof typeof SIGN_IN_PROBLEMS;

export function signInProblemMessage(code: string | undefined): string | undefined {
  // `in` would also match Object.prototype's keys, so `?error=toString` would hand the
  // page a function to render instead of a message.
  return code !== undefined && Object.hasOwn(SIGN_IN_PROBLEMS, code)
    ? SIGN_IN_PROBLEMS[code as SignInProblem]
    : undefined;
}

export function signInPathWithProblem(problem: SignInProblem): string {
  return `${SIGN_IN_PATH}?error=${problem}`;
}
