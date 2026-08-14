import type { OpenThread, Previous } from "./match.ts";

/**
 * A Thread's row on the previous latest Version, as read inside the confirm's own
 * transaction (#33) — the Open Thread set the match seam (#32) matches against.
 */
export type OpenThreadVersionRow = {
  readonly thread_id: string;
  readonly selected_text: string | null;
  readonly paragraph_text: string | null;
  readonly status: "linked" | "unlinked";
  readonly text_position_start: number | null;
  readonly text_position_end: number | null;
  readonly thread_position: number | null;
};

/**
 * `selected_text`/`paragraph_text` are null exactly when a reader deliberately Unlinked
 * this Thread (#35) — the match seam's own `text: null` means "discarded, stay Unlinked
 * regardless of what the new text says" (ADR-0004: not sticky for an Upload's own
 * Unlink, but a reader's deliberate one stays until linked by hand).
 */
export function toOpenThreads(rows: readonly OpenThreadVersionRow[]): readonly OpenThread[] {
  return rows.map((row) => ({
    id: row.thread_id,
    text: row.selected_text === null || row.paragraph_text === null
      ? null
      : { selected: row.selected_text, paragraph: row.paragraph_text },
    previous: toPrevious(row),
  }));
}

function toPrevious(row: OpenThreadVersionRow): Previous {
  if (row.status === "linked") {
    return {
      status: "linked",
      textPosition: { start: row.text_position_start!, end: row.text_position_end! },
    };
  }
  return { status: "unlinked", threadPosition: row.thread_position! };
}
