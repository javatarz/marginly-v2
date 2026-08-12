# Supabase Storage: object expiry for abandoned staged Uploads

Research for [issue #13](https://github.com/javatarz/marginly-v2/issues/13),
against Supabase's own documentation and source repositories only. Every claim
below carries the URL it came from. Where Supabase's material does not answer a
question, that is said explicitly rather than filled in with a guess.

This file sits alongside `docs/research/supabase-auth.md`, following the
convention that note established.

## Summary

**Supabase Storage has no object lifecycle, expiry, TTL or retention mechanism.**
This is not an absence of documentation — it is documented absence. The
S3-compatible endpoint lists `PutBucketLifecycleConfiguration` and
`GetBucketLifecycleConfiguration` with an explicit ❌
([S3 Compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)),
the word "lifecycle" appears exactly once across every page under
`guides/storage` and that once is those two table rows, the set of bucket options
is `public`, `fileSizeLimit`, `allowedMimeTypes` and `type` with nothing
time-based among them
([`StorageBucketApi.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageBucketApi.ts)),
the service's own bucket schema is `additionalProperties: false` so there is no
undocumented field to smuggle a TTL through
([`bucket.ts`](https://github.com/supabase/storage/blob/master/src/storage/schemas/bucket.ts)),
and the Storage service's S3 command directory contains eighteen handlers, none
of them a lifecycle handler
([`src/http/routes/s3/commands/`](https://github.com/supabase/storage/tree/master/src/http/routes/s3/commands)).
So ADR-0008's staging bucket cannot be told to clear itself.

**The ticket's first-choice alternative — `pg_cron` over `storage.objects` — is
refused by the database.** Since the March 2026 Storage release, a
statement-level trigger rejects `DELETE` on `storage.objects` and
`storage.buckets` outright unless a session GUC is set: *"Direct deletion from
storage tables is not allowed. Use the Storage API instead."*
([`0055-prevent-direct-deletes.sql`](https://github.com/supabase/storage/blob/master/migrations/tenant/0055-prevent-direct-deletes.sql)).
The reason is exactly the failure a naive sweeper would cause — *"Running `DELETE
FROM storage.objects` directly in SQL was the most common cause of orphan
objects, where the database row was removed but the file in S3 or the file
backend was not"*
([Storage release notes](https://supabase.com/blog/supabase-storage-performance-security-reliability-updates)).
A SQL sweeper would have made the quota problem permanent rather than fixed it.

**The cheapest thing that works is Supabase Cron invoking an Edge Function that
calls the Storage API, and its marginal money cost is zero.** Supabase Cron is
`pg_cron` in the project's own database
([Cron](https://supabase.com/docs/guides/cron)), appears nowhere on the pricing
page as a billable item, and a daily job spends about 30 Edge Function
invocations a month against 500,000 included on the Free plan
([Edge Function invocations](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)).
The cost is entirely operational surface, not money.

**And the money at stake is about two cents a gigabyte-month.** Storage overage
is $0.00002919 per GB-Hr — roughly **$0.021 per GB per month** —
([Storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)).
What actually bites is not the bill but the Free plan's hard **1 GB** quota
against ADR-0005's **50 MB** ceiling per bundle: **about twenty abandoned
previews fill the entire Free tier**, and ADR-0009 already caps abandonment at
one bundle per Book. That ratio, not any cost figure, is the thing to watch.

**Verdict: build nothing now.** The mechanism does not exist, the sweeper is
cheap but not free of risk, and the exposure is bounded at roughly twenty Books
before it matters on the Free plan.

## 1. No lifecycle mechanism exists

### 1.1 The S3-compatible endpoint documents it as unsupported

Supabase Storage speaks the S3 protocol — *"Supabase Storage is compatible with
the S3 protocol. You can use almost any S3 client to interact with your Storage
objects"* — and the compatibility page carries two tables of endpoints where
*"Implemented S3 endpoints are marked with ✅"*
([S3 Compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)).

The bucket-operations table has eleven rows. Five are ✅ (`ListBuckets`,
`HeadBucket`, `CreateBucket`, `DeleteBucket`, `GetBucketLocation`) and six are ❌,
two of which are the ones this ticket asks about:

| API Name | Status |
| --- | --- |
| `GetBucketLifecycleConfiguration` | ❌ |
| `PutBucketLifecycleConfiguration` | ❌ |

([source table in
`compatibility.mdx`](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/storage/s3/compatibility.mdx))

`DeleteBucketLifecycle` is not listed at all, which is consistent — there is
nothing to delete.

This is the clearest answer the ticket can get, and it is worth stating the way
Supabase states it: the endpoint is not merely undocumented, it is enumerated and
marked unsupported.

The same page also rules out the adjacent S3 feature that would otherwise
complicate a sweeper: *"**S3 versioning is not supported.** Supabase Storage does
not enable S3's versioning capabilities for buckets. Deleted objects are
permanently removed and cannot be restored"*
([S3 Compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)).
A delete is a delete; there are no noncurrent versions accumulating behind one.

### 1.2 The source repository agrees

The Storage service implements its S3 surface as one file per command. The
complete contents of
[`src/http/routes/s3/commands/`](https://github.com/supabase/storage/tree/master/src/http/routes/s3/commands)
are:

```
abort-multipart-upload.ts   delete-object.ts    list-multipart-uploads.ts
complete-multipart-upload.ts get-bucket.ts      list-objects.ts
copy-object.ts               get-object.ts      list-parts.ts
create-bucket.ts             head-bucket.ts     put-object.ts
create-multipart-upload.ts   head-object.ts     upload-part-copy.ts
delete-bucket.ts             list-buckets.ts    upload-part.ts
```

Eighteen handlers, no lifecycle handler. A repository-wide code search for
`lifecycle` in `supabase/storage` returns 24 files, and every one of them is
about something else: `src/storage/events/lifecycle/` is the webhook/event
subsystem (`object-removed`, `object-created`), `src/http/routes/tus/lifecycle.test.ts`
is resumable-upload session handling, and the remaining hits are test names using
the word in its ordinary sense. Nothing implements S3 bucket lifecycle rules.

### 1.3 There is no Supabase-native equivalent either

The S3 endpoint is one surface; the possibility remained that Supabase exposes
expiry through its own API instead. It does not.

A bucket's entire configurable surface is four properties. From `storage-js`,
verbatim:

```ts
  async createBucket(
    id: string,
    options: {
      public: boolean
      fileSizeLimit?: number | string | null
      allowedMimeTypes?: string[] | null
      type?: BucketType
    } = {
      public: false,
    }
  )
```

([`StorageBucketApi.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageBucketApi.ts))

The guide describes the same thing in prose — a bucket has an access model,
*"public"* or *"private"*, and upload restrictions covering *"max file size and
allowed content types"*
([Buckets fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals))
— and the creating-buckets guide, under the heading "Restricting uploads", says
*"When creating a bucket you can add additional configurations to restrict the
type or size of files you want this bucket to contain"* and documents only
`public`, `allowedMimeTypes` and `fileSizeLimit`
([Creating buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets)).
Nothing time-based. The only expiry anywhere in the Storage documentation is on
signed URLs, which govern how long a link works and not how long an object lives
([`createSignedUrl`](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl)).

Two things close the door on an undocumented option. The Storage service's own
bucket JSON schema is `additionalProperties: false` over exactly `id`, `name`,
`owner`, `owner_id`, `public`, `type`, `file_size_limit`, `allowed_mime_types`,
`created_at` and `updated_at`
([`src/storage/schemas/bucket.ts`](https://github.com/supabase/storage/blob/master/src/storage/schemas/bucket.ts)),
so there is no field to smuggle a TTL through — a request carrying one is
rejected, not ignored. And the published Storage OpenAPI spec contains no
occurrence of `lifecycle` or `retention` at all; its only expiry-shaped
identifier is `expiresIn`, on signed URLs, and its bucket paths are `/bucket`,
`/bucket/{bucketId}` and `/bucket/{bucketId}/empty` with no lifecycle subresource
([`storage_v0_openapi.json`](https://github.com/supabase/supabase/blob/master/apps/docs/spec/storage_v0_openapi.json)).

The documented `storage.buckets` columns match:
`id, name, created_at, updated_at, public, file_size_limit, allowed_mime_types, owner_id`
([Storage schema design](https://supabase.com/docs/guides/storage/schema/design)).

Nor does a newer bucket type have it. Supabase now has analytics (Iceberg) and
vector buckets, both in alpha, and both publish a limits page — but those pages
constrain counts, not time: *"Number of analytics buckets per project | 2"*
([Analytics limits](https://supabase.com/docs/guides/storage/analytics/limits)),
*"Buckets per project | 10"* and *"Indexes per bucket | 10"*
([Vector limits](https://supabase.com/docs/guides/storage/vector/limits)). Neither
page mentions lifecycle, retention or expiry. No bucket type has a time-based rule
that a standard bucket lacks.

For the record in the other direction: there is no documented object-count limit
on a standard bucket at all. `guides/storage/uploads/file-limits` constrains size
only
([File limits](https://supabase.com/docs/guides/storage/uploads/file-limits)). So
the accumulation ADR-0008 worries about will be felt as a storage-size quota, not
as a refused insert.

The negative evidence is worth recording precisely, because it is the kind of
thing that goes stale: a search for `lifecycle` across every file under
`apps/docs/content/guides/storage` in `supabase/supabase` returns **exactly one
file** — `s3/compatibility.mdx`, the ❌ rows above. `retention` returns nothing
relevant, and `expiry` returns two files, both about CDN cache TTL and download
behaviour
([`smart-cdn.mdx`](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/storage/cdn/smart-cdn.mdx),
[`downloads.mdx`](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/storage/serving/downloads.mdx)).

### 1.4 What does exist, and why it is not this

Two things in the Storage service look like a TTL sweeper from a distance. Both
are worth naming so nobody rediscovers them and hopes.

**`ObjectAdminDeleteAllBefore`** is an internal `pg-boss` queue job whose payload
is literally `{ before: string, bucketId: string }` — delete everything in this
bucket created before this timestamp
([`object-admin-delete-all-before.ts`](https://github.com/supabase/storage/blob/master/src/storage/events/objects/object-admin-delete-all-before.ts)).
That is exactly the primitive a lifecycle rule would need. Its only caller in the
service is `Storage.emptyBucket` — everything else that mentions it is worker
registration or a test:

```ts
  /**
   * Deletes all files in a bucket
   * @param bucketId
   * @param before limit to files before the specified time (defaults to now)
   */
  async emptyBucket(bucketId: string, before: Date = new Date()) {
```

([`src/storage/storage.ts`](https://github.com/supabase/storage/blob/master/src/storage/storage.ts))

**And the HTTP route throws the `before` parameter away.** The public
`POST /bucket/:bucketId/empty` handler takes only `bucketId` in its params schema
and calls `request.storage.emptyBucket(bucketId)` with no second argument, so
`before` defaults to *now* and the operation means "delete everything"
([`emptyBucket.ts`](https://github.com/supabase/storage/blob/master/src/http/routes/bucket/emptyBucket.ts)).
The age-bounded sweep exists in the service and is not exposed. Emptying the
staging bucket wholesale would destroy the preview of any Author who happens to
be mid-confirm, which is a worse failure than the dead bytes it reclaims.

For completeness, the endpoint is also capped: `emptyBucket` refuses if the
bucket holds more than `STORAGE_EMPTY_BUCKET_MAX` objects, default **200,000**
([`config.ts`](https://github.com/supabase/storage/blob/master/src/config.ts)),
and it is asynchronous — the documented response is *"Empty bucket has been
queued. Completion may take up to an hour."*
([`emptyBucket.ts`](https://github.com/supabase/storage/blob/master/src/http/routes/bucket/emptyBucket.ts)).

## 2. `pg_cron` over `storage.objects` does not work

This was the ticket's first-named alternative, and it is the one finding here
that changes an assumption rather than confirming one. Since the March 2026
Storage release, deleting from the `storage` schema in SQL is blocked.

```sql
CREATE OR REPLACE FUNCTION storage.protect_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;
```

with statement-level `BEFORE DELETE` triggers on both `storage.buckets` and
`storage.objects`
([`0055-prevent-direct-deletes.sql`](https://github.com/supabase/storage/blob/master/migrations/tenant/0055-prevent-direct-deletes.sql)).

Supabase's own release note explains why, and the explanation is the important
part: *"Running `DELETE FROM storage.objects` directly in SQL was the most common
cause of orphan objects, where the database row was removed but the file in S3 or
the file backend was not. A new statement-level trigger now rejects `DELETE` on
Storage schema tables unless the session variable `storage.allow_delete_query` is
set to `true`. The Storage API sets this flag automatically, so normal operations
are unaffected. Direct SQL deletes are blocked by default."*
([Storage release notes](https://supabase.com/blog/supabase-storage-performance-security-reliability-updates))

So the naive sweeper has two problems, and the second survives the first. The
trigger blocks it; and setting `storage.allow_delete_query = true` to get past
the trigger reintroduces precisely the orphaning the trigger exists to prevent —
the row disappears, the bytes stay, and the bytes are what count against the
quota. A `pg_cron` job doing raw SQL deletes would make the quota problem
*permanent and invisible*: no row left to find the file by.

Reads are unaffected. `SELECT` on `storage.objects` is not touched by the
trigger, and the table has the columns a sweeper needs to *decide* what to
delete:

```sql
CREATE TABLE IF NOT EXISTS "storage"."objects" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "bucket_id" text,
    "name" text,
    "owner" uuid,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "last_accessed_at" timestamptz DEFAULT now(),
    "metadata" jsonb,
    ...
);
```

([`0002-storage-schema.sql`](https://github.com/supabase/storage/blob/master/migrations/tenant/0002-storage-schema.sql))

That is the shape of every option below: **SQL decides, the Storage API acts.**

## 3. What the cheapest sweeper actually looks like

Three shapes are available. Only the second is worth building, and none is worth
building now.

### 3.1 Supabase Cron + `pg_net` calling the Storage API directly

Supabase Cron is `pg_cron`: *"Supabase Cron is a Postgres module that utilizes
the `pg_cron` Postgres database extension which is the scheduling and execution
engine for your Jobs"*
([Cron](https://supabase.com/docs/guides/cron)). Jobs live in the project's own
database — *"All Jobs are stored on the `cron.job` table"* with *"Every Job's run
and its status … recorded on the `cron.job_run_details` table"* — and can *"run
SQL snippets or database functions with zero network latency or make an HTTP
request, such as invoking a Supabase Edge Function"*
([Cron](https://supabase.com/docs/guides/cron)). Scheduling is
`select cron.schedule('job-name', 'schedule', 'command');`, standard five-field
cron, and *"You can use [1-59] seconds (e.g. `30 seconds`) as the cron syntax to
schedule sub-minute Jobs"*
([Cron quickstart](https://supabase.com/docs/guides/cron/quickstart)). Supabase's
own operating advice: *"For best performance, we recommend no more than 8 Jobs
run concurrently. Each Job should run no more than 10 minutes"*
([Cron](https://supabase.com/docs/guides/cron)).

Since SQL cannot delete, the job has to make an HTTP call, which means `pg_net`.
`net.http_delete` *"Creates an HTTP DELETE request, returning the request's ID"*,
and the Storage API's single-object route is
`DELETE /object/:bucketName/*` with no request body
([`deleteObject.ts`](https://github.com/supabase/storage/blob/master/src/http/routes/object/deleteObject.ts)),
so the two fit.

They fit *only* one object at a time, and that is this option's undoing. The
batch route, `DELETE /object/:bucketName`, carries a required `prefixes` array in
its **body**
([`deleteObjects.ts`](https://github.com/supabase/storage/blob/master/src/http/routes/object/deleteObjects.ts)),
and `pg_net` cannot send one: its documentation gives `net.http_delete` no body
parameter and states the extension *"Can only make POST requests with JSON data.
No other data formats are supported"*
([pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)). A
Marginly staging prefix is a whole sanitised tree — `index.html`, CSS, every
image, plus the extracted text (ADR-0009) — so one abandoned preview is tens to
hundreds of objects, and this option issues one HTTP request per object from
inside Postgres. `pg_net` is *"Intended to handle at most 200 requests per
second. Increasing the rate can introduce instability"*
([pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)).

It also gives up on knowing whether it worked. `pg_net` is asynchronous — *"HTTP
requests are not started until the transaction is committed"* — responses land in
`net._http_response`, they are *"stored for 6 hours"* by default, and the tables
are *"unlogged tables, which are not preserved during a crash or unclean
shutdown"*
([pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)). A
sweeper that fires N fire-and-forget deletes and correlates results out of a
six-hour unlogged table is more machinery than the problem deserves.

### 3.2 Supabase Cron invoking a scheduled Edge Function — the one to build, if ever

Same scheduler, one HTTP call, and the batching happens in TypeScript where
`storage-js` already has the primitives: `list()` to enumerate the staging bucket
and `remove(paths: string[])` to delete an array of them. `remove` is exactly the
body-carrying batch route `pg_net` could not reach — it sends
`{ prefixes: paths }` to `DELETE /object/{bucketId}`
([`StorageFileApi.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageFileApi.ts)).
The service's own batch ceiling is 500 objects per delete —
`MAX_KEYS_PER_S3_DELETE = 1000`, halved because *"Versioned object deletes expand
to the object key plus a `.info` sidecar key"*
([`src/storage/limits.ts`](https://github.com/supabase/storage/blob/master/src/storage/limits.ts))
— so a whole day's abandonment is one or two calls.

Marginly can do better than age-based guessing, because it knows what a live
preview is. ADR-0009 makes staging one prefix per Book and has the preview clear
that prefix before writing, so the sweep is: enumerate staging prefixes, drop the
ones whose Book has an in-flight preview, delete the rest. The `created_at`
column above is enough for the age variant if the staging row is not tracked in
Marginly's own tables.

Shape, for the record rather than to build:

```
cron.schedule('sweep-staging', '17 4 * * *',
  $$ select net.http_post(url := '<functions-url>/sweep-staging',
                          headers := '{"Authorization": "Bearer <key>"}'::jsonb) $$);
```

One invocation a day.

### 3.3 An external lifecycle tool against the S3 endpoint

Supabase's S3 endpoint does support the two operations an external sweeper needs:
`ListObjectsV2` ✅ and both `DeleteObject` ✅ and `DeleteObjects` ✅
([S3 Compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)).
So `rclone delete --min-age`, `mc rm --older-than` or an `aws s3` script would
work against
`https://project_ref.storage.supabase.co/storage/v1/s3`
([S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication)).
Deleting this way is safe from the orphaning of section 2, because the S3
endpoint *is* the Storage service — the delete handler is
`src/http/routes/s3/commands/delete-object.ts` in the same repository that owns
the `storage.objects` rows — so metadata and bytes go together. (That is an
inference from the source layout; Supabase does not state it in prose.)

But `PutBucketLifecycleConfiguration` being ❌ is the whole point: the tool cannot
hand the rule to Supabase and walk away. Something outside the project has to run
it on a schedule — a laptop, a CI cron, a box — and hold a credential to do it.
That credential is the problem. Supabase's own danger notice: *"S3 access keys
provide full access to all S3 operations across all buckets and bypass RLS
policies. These are meant to be used only on the server"*
([S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication)).

A key that reaches **all buckets** dissolves the safety property ADR-0008 bought
by putting staging in its own bucket. ADR-0008's reasoning — *"any expiry ever
configured there cannot reach a Version"* — holds for a bucket-scoped mechanism.
It does not hold for an all-buckets credential parked in a CI secret store with a
`--min-age` flag one typo away from the Versions bucket. This option is the
cheapest in money and the most expensive in risk, and it should be rejected on
that basis rather than on effort.

## 4. What it costs

### Money

Every figure below is from Supabase's own billing pages.

| Item | Free | Pro | Overage |
| --- | --- | --- | --- |
| Storage size | 1 GB | 100 GB | $0.00002919 per GB-Hr |
| Edge Function invocations | 500,000 | 2,000,000 | $2 per 1 M |
| Supabase Cron / `pg_cron` | not a billed line item | not a billed line item | — |

([Storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size),
[Edge Function invocations](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations),
[Pricing](https://supabase.com/pricing))

Storage is metered by time, not by peak: *"Storage size is charged by
Gigabyte-Hours (GB-Hrs). 1 GB-Hr represents the use of 1 GB of storage for 1
hour"*, and *"your Storage size for quota and billing is effectively the average
across the billing period, not the live size"*
([Storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)).
$0.00002919 per GB-Hr over a 730-hour month is **$0.021 per GB-month**. So a full
gigabyte of abandoned bundles sitting there for a year costs about **26 cents**.

The sweeper costs nothing. A daily Cron job is ~30 Edge Function invocations a
month, which is 0.006% of the Free plan's 500,000, and invocation billing is by
package of a million
([Edge Function invocations](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)).
Cron itself does not appear as a metered item on the pricing page or in the Cron
docs — it is an extension running in the project's own Postgres, so whatever it
consumes shows up as compute, not as a line item. Neither page states a plan
restriction on Cron, and neither states one does not exist; see open questions.

**So money is not the reason to build this, and money is not the reason not to.**
Both sides round to zero.

### The Free plan quota, which is the real number

What matters is the ratio between the quota and the object size, not the price.

ADR-0005 fixed the ceiling on a bundle at Supabase's global file size limit,
which is *"50 MB"* on the Free plan and *"500 GB"* on Pro, with per-bucket limits
that *"can't be higher than this global limit"*
([File limits](https://supabase.com/docs/guides/storage/uploads/file-limits)).
Against the Free plan's 1 GB storage quota:

- **~20 abandoned previews at the 50 MB ceiling fill the entire Free tier.**
- At a more realistic 5 MB per bundle, ~200.
- On Pro's 100 GB, ~2,000 at the ceiling.

ADR-0009 bounds abandonment at **one unconfirmed bundle per Book** — *"A Book
holds at most one unconfirmed bundle"*, and the preview deletes everything under
the Book's staging prefix before writing. So the worst case is one dead bundle per
Book whose Author walked away mid-preview, and the number to watch is Books, not
Uploads. Twenty of them is the Free-tier headroom.

Exhaustion is not a bill, it is a refusal. With a Spend Cap on (and the Free plan
behaves this way by construction), *"After exceeding the quota for a usage item,
further usage of that item is disallowed until the next billing cycle"*
([Cost control](https://supabase.com/docs/guides/platform/cost-control)), and the
storage page adds that on the Free plan *"you will get a notification to your
billing email address and put under a grace period"*
([Storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)).
The failure mode is therefore *Uploads stop working*, announced by email, not a
surprise invoice. That is a recoverable failure with a warning attached, which is
another reason not to pre-build for it.

### Operational surface

This is the column where the sweeper is actually expensive, and it is the one the
decision should turn on.

- **A scheduled job's failures are silent.** Nothing surfaces a broken Cron job
  except reading `cron.job_run_details`
  ([Cron](https://supabase.com/docs/guides/cron)). A sweeper that stopped running
  six months ago looks exactly like a sweeper that has nothing to do.
- **The job needs a credential that can delete.** Either a key in the Cron
  statement (in the `cron.job` table, in plain SQL) or one in the Function's
  environment. The `pg_net` route puts it in a database row; the Function route
  keeps it in the Function's secrets, which is better.
- **Job names are a footgun.** *"Job names are case sensitive and cannot be
  edited once created"* and *"Attempting to create a second Job with the same
  name (and case) will overwrite the first Job"*
  ([Cron quickstart](https://supabase.com/docs/guides/cron/quickstart)).
- **A delete loop is the one piece of Marginly that destroys data no Author
  asked it to.** Everything else in ADR-0008 and ADR-0009 is append-only by
  design; a Version is immutable and cannot be removed. Introducing an
  unsupervised deleter is a category change, and it earns its keep only against a
  problem that is actually happening.
- **It has to be race-aware.** ADR-0009's preview writes to staging and the
  confirm copies out of it. An age-based sweep that fires between the two would
  delete a bundle an Author is looking at, and the confirm would copy a partial
  tree into a permanent Version — the exact failure ADR-0009 spends a paragraph
  preventing for a different reason. Any sweeper must exclude in-flight previews,
  which means it needs Marginly's own state, not just `created_at`.

That last point is the strongest argument for section 3.2 over anything
lifecycle-shaped, and — since it means a hypothetical native lifecycle rule would
have been *unsafe* to use blindly anyway — it partly defuses the disappointment of
section 1.

## 5. The other dead bytes, which no sweeper can clear

Worth recording while the subject is open, because it is adjacent and easy to
conflate.

ADR-0009 accepts a second class of orphan: the confirm copies staged objects to
the Version's `storage_prefix` *before* the transaction, so a process killed
between the copy and the compensating delete leaves *"dead bytes, unreadable"* at
a prefix no `versions` row points at, in the **Versions** bucket.

Those are not sweepable by age. Every other object in that bucket is a live
Version and permanent; age says nothing. Identifying them requires a set
difference between the prefixes present in the bucket and the `storage_prefix`
values in `versions` — which SQL can compute perfectly and, per section 2, cannot
execute. So even a hypothetical S3 lifecycle rule would have been useless here,
and the Edge Function of section 3.2 is the only shape that could ever address
both classes. Another reason to keep any future sweeper in application code that
knows Marginly's tables.

## What this means for issue #13

**No mechanism exists. Close the question, build nothing.** Supabase Storage
offers no lifecycle, expiry, TTL or retention configuration, natively or through
its S3-compatible endpoint, where the two lifecycle endpoints are explicitly
marked unsupported. ADR-0008's note that this is *"unverified"* can be replaced
with a verified *no*.

**ADR-0008's consequence should be updated, not acted on.** The sentence
*"Whether Supabase Storage offers object expiry that would clear those without
code is unverified"* now has an answer, and the honest replacement says both
halves: there is no such mechanism, and the exposure ADR-0009 bounds at one
bundle per Book is small enough that nothing is built.

**Record that `pg_cron` over `storage.objects` is not an option.** This is the
one finding that changes a plan rather than confirming one. Anyone who reaches
for it later will hit `Direct deletion from storage tables is not allowed. Use the
Storage API instead.` — or, worse, will find `storage.allow_delete_query` and
orphan the bytes while thinking they freed them. That deserves to be written down
somewhere it will be read before the attempt.

**If it ever matters, the answer is Supabase Cron invoking an Edge Function.**
Daily, `storage-js` `list()` + `remove()`, batches of up to 500, skipping any
Book with an in-flight preview. Marginal cost zero on both Free and Pro. Not
`pg_net` doing its own deletes (one request per object, no batch body, async
responses in an unlogged table) and not an external S3 tool (an all-buckets
credential outside the project, which throws away the isolation ADR-0008's
separate bucket was bought for).

**The trigger to revisit is a count of Books, not a bill.** Roughly twenty Books
with abandoned previews at the 50 MB ceiling exhausts the Free plan's 1 GB, at
which point Uploads stop and an email arrives. Until the project is near that,
the dead bytes cost about two cents per gigabyte-month and are not worth a
deleter.

## Open questions, and what Supabase's material does not answer

**Whether `pg_cron` is available on the Free plan.** Neither the pricing page nor
the Cron docs state a plan restriction, and neither states there is none
([Pricing](https://supabase.com/pricing),
[Cron](https://supabase.com/docs/guides/cron)). It is a Postgres extension in the
project's own database, which suggests it is, but Supabase does not say so.
Cheap to settle by enabling it.

**Whether `last_accessed_at` on `storage.objects` is actually maintained.** The
column exists and defaults to `now()`
([`0002-storage-schema.sql`](https://github.com/supabase/storage/blob/master/migrations/tenant/0002-storage-schema.sql)),
and a later migration adds a trigger that auto-updates `updated_at`
([`0011-add-trigger-to-auto-update-updated_at-column.sql`](https://github.com/supabase/storage/blob/master/migrations/tenant/0011-add-trigger-to-auto-update-updated_at-column.sql)),
but nothing found says a read updates `last_accessed_at`. An "unread for N days"
sweep should not be designed on it without checking. `created_at` is unambiguous
and sufficient.

**Whether deleting an object stops it counting immediately.** The storage billing
page explains GB-Hrs and the billing-period average but never states outright that
a deleted object stops accruing from the moment of deletion
([Storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)).
It follows from GB-Hr metering, but it is inferred.

**Whether the March 2026 delete-protection trigger is live on all hosted
projects.** `0055-prevent-direct-deletes.sql` is on `master` in `supabase/storage`,
but the release note's only *"These changes are already live"* sits under the
object-listing rewrite, not under the delete protection, and nothing states
per-project migration status
([Storage release notes](https://supabase.com/blog/supabase-storage-performance-security-reliability-updates)).
Worth a one-line `DELETE` against a throwaway bucket before relying on either the
block or its absence.

**Whether `PutBucketLifecycleConfiguration` returns a clean error.** The
compatibility table marks it ❌ and no lifecycle handler exists in
`src/http/routes/s3/commands/`, but what an S3 client actually receives — a
`NotImplemented`, a 404, or something a tool misreads as success — is not
documented. Only matters if an external tool is ever pointed at the endpoint.

**Whether Supabase plans to add lifecycle rules.** The compatibility page says
*"The most commonly used endpoints are implemented, and more will be added"*
([S3 Compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)),
which is an intention about the S3 surface generally and says nothing about
lifecycle specifically. This finding has a shelf life; re-check the table before
building anything.
