/**
 * ADR-0011: the People panel lists the Author and every unrevoked Reviewer. Filtering
 * out revoked grants and joining reviewer ids to their addresses both already happen
 * in the query that builds `reviewers` (`revoked_at is null`, `public.users`) — this is
 * only the pure shape: the Author first, then Reviewers ordered by address.
 */
export type Person = {
  readonly id: string;
  readonly email: string;
  readonly role: "author" | "reviewer";
};

export function peopleList({
  authorId,
  authorEmail,
  reviewers,
}: {
  authorId: string;
  authorEmail: string;
  reviewers: readonly { id: string; email: string }[];
}): Person[] {
  return [
    { id: authorId, email: authorEmail, role: "author" },
    ...reviewers
      .slice()
      .sort((a, b) => a.email.localeCompare(b.email))
      .map((reviewer) => ({ id: reviewer.id, email: reviewer.email, role: "reviewer" as const })),
  ];
}
