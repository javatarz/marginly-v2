/**
 * Which Thread stays selected after a mutation refetches the Version's discussion
 * (#30): deleting a Thread's last Comment deletes the Thread itself (ADR-0006), so the
 * id a reader had selected can vanish from the refreshed list. Selection is cleared
 * only then — an edit or a reply that leaves the Thread in place never disturbs it.
 */
export function nextSelectedThreadId(
  current: string | null,
  threads: readonly { threadId: string }[],
): string | null {
  if (current === null) {
    return null;
  }

  return threads.some((thread) => thread.threadId === current) ? current : null;
}
