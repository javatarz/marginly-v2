/**
 * The dashboard, decided.
 *
 * ADR-0011 gives Marginly one dashboard route for everyone, holding two lists — Books I
 * own and Books shared with me — because a role is a property of a Book rather than of
 * an account. Everything that makes those two lists what a person reads is here: which
 * list a Book falls into, what order the rows come in, and what an empty list says.
 *
 * Nothing here touches the database. The rows arrive already filtered by the policies
 * (ADR-0010), so this never decides who may see a Book — only how what they may see
 * reads.
 *
 * **No Thread activity appears on the dashboard at all** (ADR-0011): no unread count, no
 * Open-Thread count, no newest-Comment timestamp. There is deliberately no field here to
 * carry one.
 */
export type BookRecord = {
  id: string;
  name: string;
  authorId: string;
  versionCount: number;
  /** When the latest Version was Uploaded, or null while the Book holds none. */
  latestUploadedAt: string | null;
  createdAt: string;
};

export type BookRow = {
  id: string;
  name: string;
  /** How many Versions the Book holds, in words — never a bare zero. */
  versionsHeld: string;
  /** When the latest Version was Uploaded, or null while the Book holds none. */
  latestUpload: string | null;
};

export type BookList = {
  rows: BookRow[];
  /** What to say instead of the rows, or null when there are rows to say it about. */
  emptyMessage: string | null;
};

export type DashboardView = {
  owned: BookList;
  shared: BookList;
};

export type DashboardInput = {
  accountId: string;
  books: BookRecord[];
};

const NO_BOOKS_OWNED = "You have no Books yet. Create one to start sharing your work.";

// ADR-0001 leaves this person no way to ask for access and sends them no email, so an
// empty list that says nothing reads as a broken page.
const NOTHING_SHARED =
  "Nothing has been shared with you yet. The Author will be in touch.";

// Fixed rather than the reader's locale, and UTC rather than their zone: this renders on
// the server, and a date that disagrees with the browser's would be a bug nobody can see
// from one machine.
const UPLOAD_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Which Upload a Book's dashboard row dates itself by: the newest `created_at` among
 * its Versions. A Version is immutable and numbered one past the last (ADR-0009), so
 * they are written in increasing order and the newest row is always the latest Upload
 * — there is no later Version whose timestamp could be smaller.
 */
export function latestUploadPerBook(
  versions: readonly { bookId: string; createdAt: string }[],
): Map<string, string> {
  const latest = new Map<string, string>();

  for (const version of versions) {
    const current = latest.get(version.bookId);
    if (current === undefined || Date.parse(version.createdAt) > Date.parse(current)) {
      latest.set(version.bookId, version.createdAt);
    }
  }

  return latest;
}

export function presentDashboard({ accountId, books }: DashboardInput): DashboardView {
  const owned = books.filter((entry) => entry.authorId === accountId);
  const shared = books.filter((entry) => entry.authorId !== accountId);

  return {
    owned: toBookList(owned, NO_BOOKS_OWNED),
    shared: toBookList(shared, NOTHING_SHARED),
  };
}

function toBookList(books: BookRecord[], whenEmpty: string): BookList {
  const rows = [...books].sort(byNewestFirst).map(toRow);
  return { rows, emptyMessage: rows.length === 0 ? whenEmpty : null };
}

/**
 * Newest first by the latest Upload, and by creation date for a Book holding no Versions
 * (ADR-0011) — one key, so a zero-Version Book takes its place among the rest rather
 * than sorting to an end.
 *
 * Name breaks a tie. Two Books created in the same statement share a timestamp, and an
 * order that changes between two loads of the same data reads as a bug.
 */
function byNewestFirst(a: BookRecord, b: BookRecord): number {
  const dates = sortKey(b) - sortKey(a);
  return dates === 0 ? a.name.localeCompare(b.name) : dates;
}

// Compared as instants rather than as text: Postgres writes a `timestamptz` with an
// offset and a fractional part that both vary, so two timestamps naming the same moment
// need not be the same string.
function sortKey(entry: BookRecord): number {
  return Date.parse(entry.latestUploadedAt ?? entry.createdAt);
}

function toRow(entry: BookRecord): BookRow {
  return {
    id: entry.id,
    name: entry.name,
    versionsHeld: versionsHeld(entry.versionCount),
    latestUpload:
      entry.latestUploadedAt === null
        ? null
        : UPLOAD_DATE.format(new Date(entry.latestUploadedAt)),
  };
}

function versionsHeld(count: number): string {
  if (count === 0) {
    return "No Versions";
  }
  return count === 1 ? "1 Version" : `${count} Versions`;
}
