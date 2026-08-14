/**
 * Clicking a Thread's own margin box (#31) toggles its selection rather than only ever
 * selecting it — clicking an already-selected Thread's box deselects it, so a reader
 * can dismiss a Highlight's outline and the Resolve/reply affordances it reveals
 * without having to click elsewhere on the page first.
 */
export function toggleSelectedThreadId(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}
