import { describe, expect, it } from "vitest";

import type { Person } from "./people-list";
import { showsGrantForm, showsRevokeButton } from "./people-panel-visibility";

const author: Person = { id: "author-id", email: "author@example.com", role: "author" };
const reviewer: Person = { id: "reviewer-id", email: "reviewer@example.com", role: "reviewer" };

describe("who the People panel shows controls to (ADR-0011)", () => {
  it("shows the grant field only to the Author", () => {
    expect(showsGrantForm(true)).toBe(true);
    expect(showsGrantForm(false)).toBe(false);
  });

  it("shows a Revoke button only to the Author, and only beside a Reviewer", () => {
    expect(showsRevokeButton(true, reviewer)).toBe(true);
    expect(showsRevokeButton(true, author)).toBe(false);
    expect(showsRevokeButton(false, reviewer)).toBe(false);
    expect(showsRevokeButton(false, author)).toBe(false);
  });
});
