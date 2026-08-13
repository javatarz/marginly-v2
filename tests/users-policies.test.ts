import { beforeAll, describe, expect, it } from "vitest";

import { accountId, anonClient, signedInClient } from "./support/local-stack";

/**
 * The policies on public.users, against a real database.
 *
 * ADR-0010 warns that a table without a policy fails **open** and looks finished. No
 * unit test can see that, because the rule is in Postgres — so these drive it through
 * two seeded accounts, the way the product will.
 */
describe("public.users", () => {
  const author = "policy-author@example.com";
  const reviewer = "policy-reviewer@example.com";

  let authorClient: Awaited<ReturnType<typeof signedInClient>>;
  let reviewerClient: Awaited<ReturnType<typeof signedInClient>>;

  beforeAll(async () => {
    authorClient = await signedInClient(author);
    reviewerClient = await signedInClient(reviewer);
  }, 60_000);

  it("gives a seeded account a row, written by the insert trigger", async () => {
    const { data } = await authorClient
      .from("users")
      .select("id, email")
      .eq("email", author);

    expect(data).toEqual([{ id: await accountId(authorClient), email: author }]);
  });

  it("is not readable by anon", async () => {
    const { data, error } = await anonClient().from("users").select("email");

    // anon holds no privilege on anything (ADR-0010), so this is a permission error
    // rather than an empty result.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  // ADR-0010's rule is "readable only where the reader and the subject share a Book",
  // and a revoked grant still counts as sharing one. Books and grants arrive with #21,
  // so today no two accounts share one and only the self-read is visible.
  it("does not show one account another's address", async () => {
    const { data, error } = await reviewerClient
      .from("users")
      .select("email")
      .eq("email", author);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("shows an account its own address", async () => {
    const { data } = await reviewerClient.from("users").select("email");

    expect(data).toEqual([{ email: reviewer }]);
  });

  it("refuses a write from a signed-in account", async () => {
    const { error } = await authorClient
      .from("users")
      .update({ email: "moved@example.com" })
      .eq("email", author);

    expect(error).not.toBeNull();
  });

  it("refuses an insert from a signed-in account", async () => {
    const { error } = await authorClient
      .from("users")
      .insert({ id: crypto.randomUUID(), email: "invented@example.com" });

    expect(error).not.toBeNull();
  });
});
