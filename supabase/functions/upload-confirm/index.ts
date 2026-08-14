import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { type OpenThreadVersionRow, toOpenThreads } from "../_shared/carry.ts";
import { jsonResponse } from "../_shared/http.ts";
import { decodeBearerClaims } from "../_shared/jwt.ts";
import { matchThreads } from "../_shared/match.ts";
import {
  confirmCleanupPlan,
  isBookId,
  type PendingManifest,
  pendingExtractedTextPath,
  pendingManifestPath,
  pendingObjectPath,
  stagingZipPath,
  versionObjectPath,
} from "../_shared/upload_plan.ts";

/**
 * The confirm half of an Upload (#26, ADR-0008/ADR-0009): cheap, because the preview
 * already did the expensive work and staged its output. Copies the staged bundle
 * straight into the Version's prefix and opens one raw Postgres connection through
 * Supavisor in transaction mode to bump the counter and insert the `versions` row —
 * one transaction, as the Author, under `set local role` and `set local
 * request.jwt.claims`, exactly the shape #25 built. Only where that bundle comes from
 * changed: read back from a persisted preview instead of recomputed in this same call.
 *
 * A thin I/O adapter (CODING_STANDARDS.md §2): what it wires together — the plan seam —
 * is pure and tested on its own.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "POST only." }, 405);
  }

  const authorization = req.headers.get("authorization");
  const claims = decodeBearerClaims(authorization);
  if (!claims) {
    return jsonResponse({ ok: false, message: "Sign in to Upload." }, 401);
  }

  let bookId: unknown;
  try {
    ({ bookId } = await req.json());
  } catch {
    return jsonResponse({ ok: false, message: "A bookId is required." }, 400);
  }

  if (typeof bookId !== "string" || !isBookId(bookId)) {
    return jsonResponse({ ok: false, message: "A bookId is required." }, 400);
  }

  const storage = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authorization! } } },
  ).storage;

  const [
    { data: manifestFile, error: manifestDownloadError },
    { data: textFile, error: textDownloadError },
  ] = await Promise.all([
    storage.from("staging").download(pendingManifestPath(bookId)),
    storage.from("staging").download(pendingExtractedTextPath(bookId)),
  ]);

  if (manifestDownloadError || !manifestFile) {
    return jsonResponse(
      { ok: false, message: "No preview was found to confirm. Preview an Upload first." },
      404,
    );
  }

  let manifest: PendingManifest;
  try {
    manifest = JSON.parse(await manifestFile.text());
  } catch {
    return jsonResponse(
      { ok: false, message: "The staged preview was unreadable. Preview the Upload again." },
      500,
    );
  }

  if (textDownloadError || !textFile) {
    return jsonResponse(
      { ok: false, message: "The staged preview was unreadable. Preview the Upload again." },
      500,
    );
  }

  const result = await commitVersion({
    sql: postgres(requireEnv("EDGE_DB_URL"), { prepare: false }),
    storage,
    bookId,
    sub: claims.sub,
    manifest,
    newText: await textFile.text(),
  });

  if (!result.ok) {
    return jsonResponse(
      { ok: false, message: "Could not create the Version. Nothing was saved." },
      500,
    );
  }

  return jsonResponse({ ok: true, versionNumber: result.versionNumber });
});

type CommitResult =
  | { readonly ok: true; readonly versionNumber: number }
  | { readonly ok: false };

/**
 * ADR-0009's one transaction: the bump, the `versions` insert and every Open Thread's
 * carry (#33), nothing partial. `set local role` and `set local request.jwt.claims`
 * (both LOCAL, since Supavisor's transaction-mode pooling pins this connection to one
 * transaction only) reproduce by hand what PostgREST does implicitly, so the same RLS
 * that governs a browser's own request governs this write.
 *
 * The bump's row lock is what makes two concurrent confirms on one Book stack rather
 * than collide (ADR-0009): the second transaction's `update ... returning` waits for
 * the first to commit or roll back, then reads the number it left behind.
 *
 * The Open Thread set is read here, inside this same transaction, against the
 * previous latest Version's `thread_versions` rows — never from an earlier call —
 * so a Thread started while the Author sat at the preview is carried too. Matching
 * itself is `matchThreads` (#32), a pure function; this is only the wiring around it.
 *
 * Storage cannot join the transaction, so the copy from the preview's staged bundle to
 * the Version's prefix runs inside it anyway, using the number the bump produced. A
 * copy failure throws, which rolls the bump back; the best-effort compensating delete
 * below is an optimisation, not a guarantee, exactly as ADR-0009 accepts. Neither the
 * staged bundle nor the raw zip is touched on that path, so the preview stands and the
 * Author retries the confirm without resending up to 50 MB or previewing again.
 */
async function commitVersion(args: {
  sql: ReturnType<typeof postgres>;
  storage: SupabaseClient["storage"];
  bookId: string;
  sub: string;
  manifest: PendingManifest;
  newText: string;
}): Promise<CommitResult> {
  const { sql, storage, bookId, sub, manifest, newText } = args;
  const copiedPaths: string[] = [];

  async function runCleanup(outcome: "committed" | "failed") {
    const stagingPaths = [
      stagingZipPath(bookId),
      pendingManifestPath(bookId),
      ...manifest.paths.map((path) => pendingObjectPath(bookId, path)),
    ];
    for (const step of confirmCleanupPlan(outcome, stagingPaths, copiedPaths)) {
      await storage.from(step.bucket).remove([...step.paths]);
    }
  }

  try {
    const versionNumber = await sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true)`;
      await tx`select set_config(
        'request.jwt.claims',
        ${JSON.stringify({ sub, role: "authenticated" })},
        true
      )`;

      // The same lock start_thread takes (#33's migration): serializes this bump
      // against a concurrent start_thread call on this Book, so the Open Thread set
      // read below is never missing one that landed in the gap between the two.
      await tx`select pg_advisory_xact_lock(847001001, hashtext(${bookId}))`;

      const [row] = await tx<{ latest_version_number: number }[]>`
        update books
        set latest_version_number = latest_version_number + 1
        where id = ${bookId}
        returning latest_version_number
      `;

      if (!row) {
        throw new Error(`no Book ${bookId} to Upload to`);
      }

      const versionNumber = row.latest_version_number;
      const previousVersionNumber = versionNumber - 1;

      // Only an Open Thread carries (#31/ADR-0002): `resolved_version_number is null`
      // excludes a Thread the Author Resolved while the previous Version was still
      // latest — otherwise it would gain a row on the new Version too, which ADR-0006
      // says a Resolved Thread never does past the Version it was Resolved on.
      const openThreadRows = await tx<OpenThreadVersionRow[]>`
        select
          t.id as thread_id,
          t.selected_text,
          t.paragraph_text,
          tv.status,
          lower(tv.text_position) as text_position_start,
          upper(tv.text_position) as text_position_end,
          tv.thread_position
        from threads t
        join thread_versions tv on tv.thread_id = t.id and tv.book_id = t.book_id
        where t.book_id = ${bookId}
          and tv.version_number = ${previousVersionNumber}
          and t.resolved_version_number is null
      `;

      const matched = matchThreads(toOpenThreads(openThreadRows), newText);

      for (const path of manifest.paths) {
        const destination = versionObjectPath(bookId, versionNumber, path);
        const copied = await storage.from("staging").copy(
          pendingObjectPath(bookId, path),
          destination,
          { destinationBucket: "versions" },
        );
        if (copied.error) {
          throw new Error(`could not copy ${path}: ${copied.error.message}`);
        }
        copiedPaths.push(destination);
      }

      await tx`
        insert into versions (book_id, version_number, hash)
        values (${bookId}, ${versionNumber}, ${manifest.hash})
      `;

      for (const thread of matched) {
        if (thread.status === "linked") {
          await tx`
            insert into thread_versions (thread_id, book_id, version_number, status, text_position)
            values (
              ${thread.threadId}, ${bookId}, ${versionNumber}, 'linked',
              int4range(${thread.textPosition.start}, ${thread.textPosition.end})
            )
          `;
        } else {
          await tx`
            insert into thread_versions (thread_id, book_id, version_number, status, thread_position)
            values (${thread.threadId}, ${bookId}, ${versionNumber}, 'unlinked', ${thread.threadPosition})
          `;
        }
      }

      return versionNumber;
    });

    await runCleanup("committed");
    return { ok: true, versionNumber };
  } catch (err) {
    console.error("commitVersion failed", err);
    await runCleanup("failed");
    return { ok: false };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}
