import { beforeAll, describe, expect, it } from "vitest";

import { asSuperuser, signedInClient } from "../../../../tests/support/local-stack";

import { fetchPeopleList } from "./people";

/**
 * The People panel's read (#28, ADR-0011), against a real database: the Author and
 * only the unrevoked Reviewer, over the two queries `fetchPeopleList` combines.
 */
const AUTHOR = "people-list-author@example.com";
const REVIEWER = "people-list-reviewer@example.com";
const REVOKED_REVIEWER = "people-list-revoked-reviewer@example.com";

const BOOK = "dddddddd-0000-4000-8000-000000000001";

type Client = Awaited<ReturnType<typeof signedInClient>>;

let author: Client;

beforeAll(async () => {
  [author] = await Promise.all([
    signedInClient(AUTHOR),
    signedInClient(REVIEWER),
    signedInClient(REVOKED_REVIEWER),
  ]);

  // Idempotent, the same shape tests/versions-policies.test.ts uses: a Version is
  // immutable, so this Book cannot be deleted and recreated on a second run.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${BOOK}', u.id, 'People list fixture', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name;

    insert into public.versions (book_id, version_number, hash)
    select '${BOOK}', 1, 'people-list-fixture-v1'
    where not exists (
      select 1 from public.versions where book_id = '${BOOK}' and version_number = 1
    );

    delete from public.book_reviewers where book_id = '${BOOK}';

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${BOOK}', u.id from public.users u where u.email = '${REVIEWER}';

    insert into public.book_reviewers (book_id, reviewer_id, revoked_at)
    select '${BOOK}', u.id, now() from public.users u where u.email = '${REVOKED_REVIEWER}';
  `);
}, 120_000);

describe("fetching the People panel's list", () => {
  it("lists the Author and only the unrevoked Reviewer", async () => {
    const { data: book } = await author
      .from("books")
      .select("id, author_id")
      .eq("id", BOOK)
      .single();

    const people = await fetchPeopleList(author, {
      id: book!.id,
      authorId: book!.author_id,
    });

    expect(people.map((person) => ({ email: person.email, role: person.role }))).toEqual([
      { email: AUTHOR, role: "author" },
      { email: REVIEWER, role: "reviewer" },
    ]);
  });
});
