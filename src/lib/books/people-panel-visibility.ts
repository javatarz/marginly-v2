import type { Person } from "./people-list";

/**
 * ADR-0011: both roles reach the People panel, but only the Author gets the grant
 * field and a revoke beside each Reviewer. Pulled out of the panel component itself so
 * the rule is a plain, tested decision — the component only renders what this says.
 */
export function showsGrantForm(isAuthor: boolean): boolean {
  return isAuthor;
}

export function showsRevokeButton(isAuthor: boolean, person: Person): boolean {
  return isAuthor && person.role === "reviewer";
}
