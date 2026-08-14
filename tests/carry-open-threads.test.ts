import { beforeAll, describe, expect, it } from "vitest";

import { asSuperuser, signedInClient } from "./support/local-stack";
import { buildZip } from "./support/zip";

/**
 * Carrying Open Threads into a new Version (#33) — ADR-0002/0004/0006/0009/0014.
 *
 * The confirm's transaction (#26) now also carries every Open Thread: it reads the
 * Thread set as it stands on the previous latest Version, matches it against the new
 * Version's extracted text with the pure match seam (#32), and writes one
 * `thread_versions` row per Thread. This drives that through the real Edge Functions
 * and the real database, the way `match_test.ts`'s unit tests on the pure seam itself
 * cannot.
 */
const AUTHOR = "carry-author@example.com";
const REVIEWER = "carry-reviewer@example.com";

const CARRY_BOOK = "ffffffff-0000-4000-8000-000000000001";

const BOOKS = [CARRY_BOOK];

type Client = Awaited<ReturnType<typeof signedInClient>>;

type PreviewOutcome = { ok: true } | { ok: false; message: string };
type ConfirmOutcome =
  | { ok: true; versionNumber: number }
  | { ok: false; message: string };

let author: Client;
let reviewer: Client;

beforeAll(async () => {
  [author, reviewer] = await Promise.all([
    signedInClient(AUTHOR),
    signedInClient(REVIEWER),
  ]);

  asSuperuser(
    BOOKS.map((id, index) => `
      insert into public.books (id, author_id, name, latest_version_number)
      select '${id}', u.id, 'Carry Target ${index + 1}', 0
      from public.users u where u.email = '${AUTHOR}'
      on conflict (id) do update set author_id = excluded.author_id;

      insert into public.book_reviewers (book_id, reviewer_id)
      select '${id}', u.id from public.users u where u.email = '${REVIEWER}'
      on conflict (book_id, reviewer_id) do nothing;
    `).join("\n"),
  );
}, 120_000);

async function stageZip(book: string, zip: Uint8Array): Promise<void> {
  const { error } = await author.storage
    .from("staging")
    .upload(`${book}/upload.zip`, zip, { upsert: true, contentType: "application/zip" });
  expect(error).toBeNull();
}

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

async function threadVersionRow(threadId: string, versionNumber: number) {
  const { data } = await author
    .from("thread_versions")
    .select("status, text_position, thread_position")
    .eq("thread_id", threadId)
    .eq("version_number", versionNumber)
    .maybeSingle();
  return data;
}

// A Version is immutable, so a repeat run of this suite (without a `supabase db
// reset` in between) finds this Book already holding earlier runs' Versions —
// this run's own marker keeps every confirmed body unique across runs.
const RUN = Date.now().toString(36);
const zip = (entries: { path: string; content: string }[]) => buildZip(entries);

describe("carrying Open Threads across an Upload", () => {
  it("keeps a surviving passage Linked at its new offset, and Unlinks a cut one at its old start — then re-links it once restored", async () => {
    const v1 = await previewAndConfirm(
      CARRY_BOOK,
      zip([{
        path: "index.html",
        content: `
          <p>Alpha paragraph keeps its own sentence here ${RUN}.</p>
          <p>Beta paragraph will vanish completely next time ${RUN}.</p>
        `,
      }]),
    );

    const v1Text = await extractedText(CARRY_BOOK, v1);
    const alphaSelected = `keeps its own sentence here ${RUN}`;
    const betaSelected = `will vanish completely next time ${RUN}`;

    const alphaStart = v1Text.indexOf(alphaSelected);
    const betaStart = v1Text.indexOf(betaSelected);
    expect(alphaStart).toBeGreaterThanOrEqual(0);
    expect(betaStart).toBeGreaterThanOrEqual(0);

    const { data: alphaThreadId, error: alphaStartError } = await reviewer.rpc("start_thread", {
      book: CARRY_BOOK,
      range_start: alphaStart,
      range_end: alphaStart + alphaSelected.length,
      selected_text: alphaSelected,
      paragraph_text: `Alpha paragraph keeps its own sentence here ${RUN}.`,
      body: "surviving thread",
    });
    expect(alphaStartError).toBeNull();

    const { data: betaThreadId, error: betaStartError } = await reviewer.rpc("start_thread", {
      book: CARRY_BOOK,
      range_start: betaStart,
      range_end: betaStart + betaSelected.length,
      selected_text: betaSelected,
      paragraph_text: `Beta paragraph will vanish completely next time ${RUN}.`,
      body: "doomed thread",
    });
    expect(betaStartError).toBeNull();

    // v2: an intro paragraph shifts Alpha's offset; Beta's whole paragraph is replaced.
    const v2 = await previewAndConfirm(
      CARRY_BOOK,
      zip([{
        path: "index.html",
        content: `
          <p>An unrelated intro paragraph pushes things down ${RUN}.</p>
          <p>Alpha paragraph keeps its own sentence here ${RUN}.</p>
          <p>Something totally different now replaces Beta ${RUN}.</p>
        `,
      }]),
    );
    expect(v2).toBe(v1 + 1);

    const v2Text = await extractedText(CARRY_BOOK, v2);
    const alphaV2Start = v2Text.indexOf(alphaSelected);
    expect(alphaV2Start).toBeGreaterThan(alphaStart);

    const alphaOnV2 = await threadVersionRow(alphaThreadId!, v2);
    expect(alphaOnV2?.status).toBe("linked");
    expect(alphaOnV2?.text_position).toBe(`[${alphaV2Start},${alphaV2Start + alphaSelected.length})`);

    const betaOnV2 = await threadVersionRow(betaThreadId!, v2);
    expect(betaOnV2?.status).toBe("unlinked");
    // The carry rule: an Unlinked Thread's placement is the start of its previous
    // (Linked) text_position.
    expect(betaOnV2?.thread_position).toBe(betaStart);

    // v3: Beta's original sentence comes back verbatim — the Unlinked Thread reclaims it,
    // because Unlinking keeps its text and retries on every later Upload.
    const v3 = await previewAndConfirm(
      CARRY_BOOK,
      zip([{
        path: "index.html",
        content: `
          <p>Alpha paragraph keeps its own sentence here ${RUN}.</p>
          <p>Beta paragraph will vanish completely next time ${RUN}.</p>
        `,
      }]),
    );
    expect(v3).toBe(v2 + 1);

    const v3Text = await extractedText(CARRY_BOOK, v3);
    const betaV3Start = v3Text.indexOf(betaSelected);

    const betaOnV3 = await threadVersionRow(betaThreadId!, v3);
    expect(betaOnV3?.status).toBe("linked");
    expect(betaOnV3?.text_position).toBe(`[${betaV3Start},${betaV3Start + betaSelected.length})`);

    const alphaOnV3 = await threadVersionRow(alphaThreadId!, v3);
    expect(alphaOnV3?.status).toBe("linked");

    // The row this suite's own on-v1 assertions rely on stays exactly as v1 confirmed it —
    // no later confirm ever touches a Version once it stops being the latest.
    const alphaOnV1 = await threadVersionRow(alphaThreadId!, v1);
    expect(alphaOnV1?.text_position).toBe(`[${alphaStart},${alphaStart + alphaSelected.length})`);
  }, 60_000);

  it("refuses to update or delete a thread_versions row belonging to a superseded Version", async () => {
    const v1 = await previewAndConfirm(
      CARRY_BOOK,
      zip([{ path: "index.html", content: `<p>Immutability check ${RUN}.</p>` }]),
    );

    const { data: threadId, error: startError } = await author.rpc("start_thread", {
      book: CARRY_BOOK,
      range_start: 0,
      range_end: 5,
      selected_text: "Immut",
      paragraph_text: `Immutability check ${RUN}.`,
      body: "will be superseded",
    });
    expect(startError).toBeNull();

    // Supersede it — v1's row is no longer the latest Version's.
    await previewAndConfirm(
      CARRY_BOOK,
      zip([{ path: "index.html", content: `<p>Immutability check moved on ${RUN}.</p>` }]),
    );

    const { error: updateError } = await author
      .from("thread_versions")
      .update({ status: "unlinked", thread_position: 0 })
      .eq("thread_id", threadId!)
      .eq("version_number", v1);
    expect(updateError).not.toBeNull();

    const { error: deleteError } = await author
      .from("thread_versions")
      .delete()
      .eq("thread_id", threadId!)
      .eq("version_number", v1);
    expect(deleteError).not.toBeNull();

    const stillThere = await threadVersionRow(threadId!, v1);
    expect(stillThere).not.toBeNull();
  }, 60_000);
});
