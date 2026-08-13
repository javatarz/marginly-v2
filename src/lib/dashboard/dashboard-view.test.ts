import { describe, expect, it } from "vitest";

import {
  latestUploadPerBook,
  presentDashboard,
  type BookList,
  type BookRecord,
  type BookRow,
} from "./dashboard-view";

const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE_ELSE = "22222222-2222-2222-2222-222222222222";

function book(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: "book-1",
    name: "A Book",
    authorId: ME,
    versionCount: 0,
    latestUploadedAt: null,
    createdAt: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

function onlyRow(list: BookList): BookRow {
  expect(list.rows).toHaveLength(1);
  return list.rows[0] as BookRow;
}

describe("the dashboard's two lists", () => {
  it("puts a Book I wrote under the ones I own", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [book({ id: "mine", name: "Mine", authorId: ME })],
    });

    expect(view.owned.rows.map((row) => row.id)).toEqual(["mine"]);
    expect(view.shared.rows).toEqual([]);
  });

  // A role is a property of a Book rather than of an account (ADR-0011), so the same
  // person appears in both lists on one dashboard.
  it("puts a Book someone else wrote under the ones shared with me", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [
        book({ id: "mine", authorId: ME }),
        book({ id: "theirs", authorId: SOMEONE_ELSE }),
      ],
    });

    expect(view.owned.rows.map((row) => row.id)).toEqual(["mine"]);
    expect(view.shared.rows.map((row) => row.id)).toEqual(["theirs"]);
  });

  it("sorts by the latest Upload, newest first", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [
        book({
          id: "older",
          versionCount: 2,
          latestUploadedAt: "2026-07-01T09:00:00Z",
        }),
        book({
          id: "newer",
          versionCount: 1,
          latestUploadedAt: "2026-08-10T09:00:00Z",
        }),
      ],
    });

    expect(view.owned.rows.map((row) => row.id)).toEqual(["newer", "older"]);
  });

  // ADR-0011: a Book holding no Versions has no Upload date to sort by, so it takes
  // its place from when it was created rather than falling to the bottom.
  it("sorts a Book holding no Versions by when it was created", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [
        book({
          id: "uploaded-in-july",
          versionCount: 1,
          latestUploadedAt: "2026-07-01T09:00:00Z",
        }),
        book({ id: "created-in-august", createdAt: "2026-08-01T09:00:00Z" }),
        book({
          id: "uploaded-in-june",
          versionCount: 1,
          latestUploadedAt: "2026-06-01T09:00:00Z",
        }),
      ],
    });

    expect(view.owned.rows.map((row) => row.id)).toEqual([
      "created-in-august",
      "uploaded-in-july",
      "uploaded-in-june",
    ]);
  });

  // Two Books can share a date, and a dashboard whose order changes between two loads
  // of the same data reads as a bug.
  it("settles two Books sharing a date by name", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [
        book({ id: "second", name: "Bravo", createdAt: "2026-08-01T09:00:00Z" }),
        book({ id: "first", name: "Alpha", createdAt: "2026-08-01T09:00:00Z" }),
      ],
    });

    expect(view.owned.rows.map((row) => row.id)).toEqual(["first", "second"]);
  });

  it("sorts the shared list the same way", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [
        book({
          id: "older",
          authorId: SOMEONE_ELSE,
          versionCount: 1,
          latestUploadedAt: "2026-07-01T09:00:00Z",
        }),
        book({
          id: "newer",
          authorId: SOMEONE_ELSE,
          versionCount: 1,
          latestUploadedAt: "2026-08-10T09:00:00Z",
        }),
      ],
    });

    expect(view.shared.rows.map((row) => row.id)).toEqual(["newer", "older"]);
  });
});

describe("what a dashboard row says about a Book", () => {
  it("names the Book", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [book({ name: "The Salt Road" })],
    });

    expect(onlyRow(view.owned).name).toBe("The Salt Road");
  });

  // ADR-0011: a zero-Version Book reads as having none, not as an error.
  it("reads a Book with no Versions as holding none", () => {
    const view = presentDashboard({ accountId: ME, books: [book()] });

    expect(onlyRow(view.owned).versionsHeld).toBe("No Versions");
    expect(onlyRow(view.owned).latestUpload).toBeNull();
  });

  it("counts one Version in the singular", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [book({ versionCount: 1, latestUploadedAt: "2026-08-10T09:00:00Z" })],
    });

    expect(onlyRow(view.owned).versionsHeld).toBe("1 Version");
  });

  it("counts several Versions in the plural", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [book({ versionCount: 7, latestUploadedAt: "2026-08-10T09:00:00Z" })],
    });

    expect(onlyRow(view.owned).versionsHeld).toBe("7 Versions");
  });

  // Rendered from the instant in UTC rather than the reader's zone: a server component
  // and a browser in different zones would otherwise disagree about the date shown.
  it("says when the latest Version was Uploaded", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [book({ versionCount: 1, latestUploadedAt: "2026-08-10T23:30:00Z" })],
    });

    expect(onlyRow(view.owned).latestUpload).toBe("10 Aug 2026");
  });
});

describe("a dashboard with nothing on it", () => {
  // ADR-0011: an Author with no Books is invited to create one.
  it("invites an Author with no Books to create one", () => {
    const view = presentDashboard({ accountId: ME, books: [] });

    expect(view.owned.emptyMessage).toBe(
      "You have no Books yet. Create one to start sharing your work.",
    );
  });

  // ADR-0001 leaves this person no way to ask, and no email is coming.
  it("tells a person with nothing shared that the Author will be in touch", () => {
    const view = presentDashboard({ accountId: ME, books: [] });

    expect(view.shared.emptyMessage).toBe(
      "Nothing has been shared with you yet. The Author will be in touch.",
    );
  });

  it("says nothing about an empty list once it holds a Book", () => {
    const view = presentDashboard({
      accountId: ME,
      books: [book({ authorId: ME }), book({ id: "theirs", authorId: SOMEONE_ELSE })],
    });

    expect(view.owned.emptyMessage).toBeNull();
    expect(view.shared.emptyMessage).toBeNull();
  });
});

describe("which Upload a Book dates itself by", () => {
  it("says a Book with no Versions holds no Upload date", () => {
    expect(latestUploadPerBook([]).get("book-1")).toBeUndefined();
  });

  it("takes the one Version a Book holds", () => {
    const latest = latestUploadPerBook([
      { bookId: "book-1", createdAt: "2026-08-01T09:00:00Z" },
    ]);

    expect(latest.get("book-1")).toBe("2026-08-01T09:00:00Z");
  });

  // A Version is immutable and numbered one past the last (ADR-0009), so they arrive in
  // increasing order — but the newest-first check here does not assume that order holds.
  it("takes the newest of several Versions, regardless of row order", () => {
    const latest = latestUploadPerBook([
      { bookId: "book-1", createdAt: "2026-08-10T09:00:00Z" },
      { bookId: "book-1", createdAt: "2026-07-01T09:00:00Z" },
      { bookId: "book-1", createdAt: "2026-08-05T09:00:00Z" },
    ]);

    expect(latest.get("book-1")).toBe("2026-08-10T09:00:00Z");
  });

  it("keeps each Book's latest Upload separate", () => {
    const latest = latestUploadPerBook([
      { bookId: "book-1", createdAt: "2026-08-01T09:00:00Z" },
      { bookId: "book-2", createdAt: "2026-08-02T09:00:00Z" },
    ]);

    expect(latest.get("book-1")).toBe("2026-08-01T09:00:00Z");
    expect(latest.get("book-2")).toBe("2026-08-02T09:00:00Z");
  });
});
