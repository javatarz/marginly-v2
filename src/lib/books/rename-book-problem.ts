import { createBookProblemMessage, type CreateBookProblem } from "@/lib/books/create-book-problem";

/**
 * ADR-0011: rename's collision refusal is the same shape as the create form's, so it
 * reuses create's problem wording rather than a second copy of it — "empty" and
 * "duplicate" mean the same thing about a Book's name wherever the name is set.
 *
 * Only the path differs: create fails back to the dashboard, rename fails back to the
 * Book page it was opened from.
 */
export const renameBookProblemMessage = createBookProblemMessage;

export function bookPathWithRenameProblem(bookId: string, problem: CreateBookProblem): string {
  return `/books/${bookId}?renameError=${problem}`;
}
