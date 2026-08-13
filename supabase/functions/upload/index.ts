import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { jsonResponse } from "../_shared/http.ts";
import { decodeBearerClaims } from "../_shared/jwt.ts";
import { previewUpload } from "../_shared/preview.ts";
import { unzip } from "../_shared/preview/unzip.ts";
import {
  isBookId,
  type PlannedObject,
  planVersionObjects,
  stagingZipPath,
  storageCleanupPlan,
  versionObjectPath,
} from "../_shared/upload_plan.ts";

/**
 * Upload a Version, straight through (#25) — the tracer bullet ADR-0009 and ADR-0015
 * describe, without the preview/confirm split #26 adds on top of it.
 *
 * The browser has already put the zip at the Book's staging prefix; this receives a
 * path, not a body. Everything through the preview seam runs as this Author, under
 * their own Storage policies. The version-number bump and the `versions` insert run in
 * one transaction on a raw Postgres connection through Supavisor in transaction mode —
 * PostgREST cannot express "the bump, the insert, nothing partial" as one request.
 *
 * This is a thin I/O adapter (CODING_STANDARDS.md §2): the decisions it wires together —
 * what the preview seam decides, what upload_plan.ts decides — are pure and tested on
 * their own. What is left here is wiring, covered by integration tests rather than unit
 * tests.
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

  const { data: zipFile, error: downloadError } = await storage
    .from("staging")
    .download(stagingZipPath(bookId));

  if (downloadError || !zipFile) {
    return jsonResponse(
      { ok: false, message: "No staged Upload was found for this Book." },
      404,
    );
  }

  const zipBytes = new Uint8Array(await zipFile.arrayBuffer());

  const preview = await previewUpload(zipBytes);
  if (!preview.ok) {
    return jsonResponse(preview, 422);
  }

  const files = await unzip(zipBytes);
  const objects = planVersionObjects(files, preview);

  const result = await commitVersion({
    sql: postgres(requireEnv("EDGE_DB_URL"), { prepare: false }),
    storage,
    bookId,
    sub: claims.sub,
    objects,
  });

  if (!result.ok) {
    return jsonResponse(
      { ok: false, message: "Could not create the Version. Nothing was saved." },
      500,
    );
  }

  await storage.from("staging").remove([stagingZipPath(bookId)]);

  return jsonResponse({ ok: true, versionNumber: result.versionNumber });
});

type CommitResult =
  | { readonly ok: true; readonly versionNumber: number }
  | { readonly ok: false };

/**
 * ADR-0009's one transaction: the bump and the `versions` insert, nothing partial.
 * `set local role` and `set local request.jwt.claims` (both LOCAL, since Supavisor's
 * transaction-mode pooling pins this connection to one transaction only) reproduce by
 * hand what PostgREST does implicitly, so the same RLS that governs a browser's own
 * request governs this write.
 *
 * The bump's row lock is what makes two concurrent Uploads on one Book stack rather
 * than collide (ADR-0009): the second transaction's `update ... returning` waits for
 * the first to commit or roll back, then reads the number it left behind.
 *
 * Storage cannot join the transaction, so the copy to the Version's prefix runs inside
 * it anyway, using the number the bump produced — and so does staging this
 * invocation's own sanitised output on its way there. Staging happens here, after the
 * bump, rather than once up front before any transaction opens, because two
 * invocations racing over the *same* Book would otherwise both write the identical
 * shared staging paths: one's upsert can replace the on-disk object the other is
 * mid-copy from, which surfaces as a bare storage ENOENT with nothing to say why. Each
 * invocation's own version number — unique, because the row lock serialises who gets
 * which — is what keeps two concurrent Uploads' staging writes out of each other's
 * way. A copy or staging failure throws, which rolls the bump back; the best-effort
 * compensating delete below is an optimisation, not a guarantee, exactly as ADR-0009
 * accepts.
 */
async function commitVersion(args: {
  sql: ReturnType<typeof postgres>;
  storage: SupabaseClient["storage"];
  bookId: string;
  sub: string;
  objects: readonly PlannedObject[];
}): Promise<CommitResult> {
  const { sql, storage, bookId, sub, objects } = args;
  const copiedPaths: string[] = [];
  const stagedPaths: string[] = [];

  async function runCleanup(outcome: "committed" | "failed") {
    for (const step of storageCleanupPlan(outcome, stagedPaths, copiedPaths)) {
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

      for (const object of objects) {
        const path = versionObjectPath(bookId, versionNumber, object.path);

        const staged = await storage.from("staging").upload(path, object.bytes, {
          upsert: true,
          contentType: "application/octet-stream",
        });
        if (staged.error) {
          throw new Error(`could not stage ${object.path}: ${staged.error.message}`);
        }
        stagedPaths.push(path);

        const copied = await storage.from("staging").copy(path, path, {
          destinationBucket: "versions",
        });
        if (copied.error) {
          throw new Error(`could not copy ${object.path}: ${copied.error.message}`);
        }
        copiedPaths.push(path);
      }

      await tx`
        insert into versions (book_id, version_number)
        values (${bookId}, ${versionNumber})
      `;

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
