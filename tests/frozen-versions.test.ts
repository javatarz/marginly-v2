import { beforeAll, describe, expect, it } from "vitest";

import { asSuperuser, signedInClient } from "./support/local-stack";
import { buildZip } from "./support/zip";

/**
 * Frozen Versions (#34), against a real database — ADR-0002/0003/0006/0010.
 *
 * `version_threads` is the one shared read every page that opens a Version calls
 * (20260814100000_frozen_versions.sql). Two things about it were still wrong the day
 * #33 landed: it only ever selected a Thread's Linked row, so an Unlinked Thread — the
 * exact state #33's carry produces — was invisible on every Version including the
 * latest; and it returned every Comment a Thread ever held, with no regard for which
 * Version was asked for. Both are this ticket's fix, driven here through the real
 * function rather than asserted against `thread_versions` and `comments` directly.
 */
const AUTHOR = "frozen-author@example.com";
const REVIEWER = "frozen-reviewer@example.com";

const CUTOFF_BOOK = "abcdef00-0000-4000-8000-000000000001";
const CARRY_BOOK = "abcdef00-0000-4000-8000-000000000002";

type Client = Awaited<ReturnType<typeof signedInClient>>;

let author: Client;
let reviewer: Client;

beforeAll(async () => {
  [author, reviewer] = await Promise.all([signedInClient(AUTHOR), signedInClient(REVIEWER)]);

  // CUTOFF_BOOK is reset to latest 1 on every run, the same "already-bumped" trick
  // tests/comments-policies.test.ts uses for FREEZE_BOOK — so the cut-off test below is
  // self-contained regardless of run history.
  asSuperuser(`
    insert into public.books (id, author_id, name, latest_version_number)
    select '${CUTOFF_BOOK}', u.id, 'Comment Cut-off', 1
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id, name = excluded.name,
      latest_version_number = 1;

    insert into public.versions (book_id, version_number, hash)
    select '${CUTOFF_BOOK}', 1, 'frozen-test-cutoff-v1'
    where not exists (
      select 1 from public.versions where book_id = '${CUTOFF_BOOK}' and version_number = 1
    );

    update public.books set latest_version_number = 2 where id = '${CUTOFF_BOOK}';

    insert into public.versions (book_id, version_number, hash)
    select '${CUTOFF_BOOK}', 2, 'frozen-test-cutoff-v2'
    where not exists (
      select 1 from public.versions where book_id = '${CUTOFF_BOOK}' and version_number = 2
    );

    update public.books set latest_version_number = 1 where id = '${CUTOFF_BOOK}';

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${CUTOFF_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;

    insert into public.books (id, author_id, name, latest_version_number)
    select '${CARRY_BOOK}', u.id, 'Frozen Link State', 0
    from public.users u where u.email = '${AUTHOR}'
    on conflict (id) do update set author_id = excluded.author_id;

    insert into public.book_reviewers (book_id, reviewer_id)
    select '${CARRY_BOOK}', u.id from public.users u where u.email = '${REVIEWER}'
    on conflict (book_id, reviewer_id) do nothing;
  `);
}, 120_000);

describe("version_threads — the Comment cut-off", () => {
  it("shows only the Comments a Version had when it froze", async () => {
    const { data: threadId, error: startError } = await reviewer.rpc("start_thread", {
      book: CUTOFF_BOOK,
      range_start: 0,
      range_end: 5,
      selected_text: "hello",
      paragraph_text: "hello world",
      body: "written while v1 was latest",
    });
    expect(startError).toBeNull();

    // Carries the Thread onto v2 the way #33's confirm would — a plain `linked` row at
    // the same position, since nothing about the text changed for this test's purposes.
    asSuperuser(`
      update public.books set latest_version_number = 2 where id = '${CUTOFF_BOOK}';

      insert into public.thread_versions (thread_id, book_id, version_number, status, text_position)
      values ('${threadId}', '${CUTOFF_BOOK}', 2, 'linked', '[0,5)')
      on conflict (thread_id, version_number) do nothing;
    `);

    const { data: laterCommentId, error: laterCommentError } = await reviewer.rpc("add_comment", {
      thread: threadId!,
      body: "written once v2 was latest",
    });
    expect(laterCommentError).toBeNull();
    expect(laterCommentId).toEqual(expect.any(String));

    const { data: onV1, error: v1Error } = await reviewer.rpc("version_threads", {
      book: CUTOFF_BOOK,
      version_number: 1,
    });
    expect(v1Error).toBeNull();
    const rowOnV1 = onV1?.find((row) => row.thread_id === threadId);
    expect(rowOnV1?.comments).toEqual([
      expect.objectContaining({ body: "written while v1 was latest" }),
    ]);

    const { data: onV2, error: v2Error } = await reviewer.rpc("version_threads", {
      book: CUTOFF_BOOK,
      version_number: 2,
    });
    expect(v2Error).toBeNull();
    const rowOnV2 = onV2?.find((row) => row.thread_id === threadId);
    expect(rowOnV2?.comments).toEqual([
      expect.objectContaining({ body: "written while v1 was latest" }),
      expect.objectContaining({ body: "written once v2 was latest" }),
    ]);
  });
});

describe("version_threads — a Thread's frozen link state and position", () => {
  async function stageZip(book: string, zip: Uint8Array): Promise<void> {
    const { error } = await author.storage
      .from("staging")
      .upload(`${book}/upload.zip`, zip, { upsert: true, contentType: "application/zip" });
    expect(error).toBeNull();
  }

  type PreviewOutcome = { ok: true } | { ok: false; message: string };
  type ConfirmOutcome = { ok: true; versionNumber: number } | { ok: false; message: string };

  async function previewAndConfirm(book: string, zip: Uint8Array): Promise<number> {
    await stageZip(book, zip);

    const { data: preview, error: previewError } = await author
      .functions.invoke<PreviewOutcome>("upload-preview", { body: { bookId: book } });
    expect(previewError).toBeNull();
    expect(preview?.ok).toBe(true);

    const { data: confirmed, error: confirmError } = await author
      .functions.invoke<ConfirmOutcome>("upload-confirm", { body: { bookId: book } });
    expect(confirmError).toBeNull();
    if (!confirmed?.ok) {
      throw new Error(`expected the confirm to succeed, got ${JSON.stringify(confirmed)}`);
    }
    return confirmed.versionNumber;
  }

  async function extractedText(book: string, versionNumber: number): Promise<string> {
    const { data, error } = await author.storage
      .from("versions")
      .download(`${book}/${versionNumber}/text.txt`);
    expect(error).toBeNull();
    return (await data?.text()) ?? "";
  }

  const RUN = Date.now().toString(36);

  it("reads Linked on the Version it was carried Linked onto, and Unlinked on the one that cut its passage", async () => {
    const v1 = await previewAndConfirm(
      CARRY_BOOK,
      buildZip([{
        path: "index.html",
        content: `<p>Gamma paragraph holds a sentence worth keeping ${RUN}.</p>`,
      }]),
    );

    const v1Text = await extractedText(CARRY_BOOK, v1);
    const selected = `holds a sentence worth keeping ${RUN}`;
    const start = v1Text.indexOf(selected);
    expect(start).toBeGreaterThanOrEqual(0);

    const { data: threadId, error: startError } = await reviewer.rpc("start_thread", {
      book: CARRY_BOOK,
      range_start: start,
      range_end: start + selected.length,
      selected_text: selected,
      paragraph_text: `Gamma paragraph holds a sentence worth keeping ${RUN}.`,
      body: "will be frozen Linked on v1, Unlinked on v2",
    });
    expect(startError).toBeNull();

    const { data: onV1, error: v1Error } = await reviewer.rpc("version_threads", {
      book: CARRY_BOOK,
      version_number: v1,
    });
    expect(v1Error).toBeNull();
    const rowOnV1 = onV1?.find((row) => row.thread_id === threadId);
    expect(rowOnV1?.status).toBe("linked");
    expect(rowOnV1?.text_position).toBe(`[${start},${start + selected.length})`);
    expect(rowOnV1?.thread_position).toBeNull();

    // v2 replaces Gamma's whole paragraph, cutting the passage this Thread is rooted on.
    const v2 = await previewAndConfirm(
      CARRY_BOOK,
      buildZip([{ path: "index.html", content: `<p>Something else entirely now ${RUN}.</p>` }]),
    );
    expect(v2).toBe(v1 + 1);

    const { data: onV2, error: v2Error } = await reviewer.rpc("version_threads", {
      book: CARRY_BOOK,
      version_number: v2,
    });
    expect(v2Error).toBeNull();
    const rowOnV2 = onV2?.find((row) => row.thread_id === threadId);
    expect(rowOnV2?.status).toBe("unlinked");
    expect(rowOnV2?.text_position).toBeNull();
    expect(rowOnV2?.thread_position).toBe(start);

    // v1's own row is untouched by v2's confirm — reading it again still shows Linked at
    // its original offset, exactly what "no sign of what followed" (#34) requires.
    const { data: onV1Again } = await reviewer.rpc("version_threads", {
      book: CARRY_BOOK,
      version_number: v1,
    });
    const rowOnV1Again = onV1Again?.find((row) => row.thread_id === threadId);
    expect(rowOnV1Again?.status).toBe("linked");
    expect(rowOnV1Again?.text_position).toBe(`[${start},${start + selected.length})`);
  }, 60_000);
});
