#!/usr/bin/env node
//
// The only account creator, and the only holder of the service_role key (ADR-0001,
// ADR-0010).
//
// There is no sign-up flow. An operator runs this to create Author and Reviewer
// accounts by email address, before anyone can sign in and before an Author can grant
// a Reviewer access to a Book.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-accounts.mjs author@example.com reviewer@example.com
//
// Or, against the local stack:
//
//   node scripts/seed-accounts.mjs --local author@example.com
//
// `--link <email>` prints a sign-in token hash for an address instead of creating one.
// Issue #6 found the built-in mailer refuses any address outside the Supabase
// organisation's team, so handing a link to a person directly is the operator's way
// past that. It sends no email either.
//
// `email_confirm: true` is not optional — without it a seeded account cannot sign in
// at all (issue #6). Creating an account this way sends no email, so seeding costs
// nothing out of the mailer's two-an-hour budget. Re-runs are safe: an address that
// already has an account is reported and left alone.

import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const local = args.includes("--local");
const linkOnly = args.includes("--link");
const emails = args.filter((arg) => !arg.startsWith("--"));

if (emails.length === 0) {
  console.error(
    "usage: node scripts/seed-accounts.mjs [--local] [--link] <email> [<email> ...]",
  );
  process.exit(2);
}

const { url, serviceRoleKey } = local ? localCredentials() : environmentCredentials();

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failed = false;

for (const email of emails) {
  const address = email.trim().toLowerCase();

  if (linkOnly) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: address,
    });

    if (error) {
      failed = true;
      console.error(`failed   ${address}  ${error.message}`);
      continue;
    }

    // The token hash, not the whole link: it is what /auth/confirm verifies, and
    // printing it keeps the site URL out of an operator's copy-paste.
    console.log(`${address} ${data.properties.hashed_token}`);
    continue;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: address,
    email_confirm: true,
  });

  if (!error) {
    console.log(`created  ${address}  (${data.user.id})`);
    continue;
  }

  if (error.code === "email_exists") {
    console.log(`exists   ${address}`);
    continue;
  }

  failed = true;
  console.error(`failed   ${address}  ${error.message}`);
}

process.exit(failed ? 1 : 0);

function environmentCredentials() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --local to read them from the running local stack.",
    );
    process.exit(2);
  }

  return { url, serviceRoleKey };
}

// The local stack's own keys, read from the CLI rather than from the environment, so
// seeding a development database needs no secret to be exported first.
function localCredentials() {
  const status = JSON.parse(
    execFileSync("supabase", ["status", "--output", "json"], {
      encoding: "utf8",
    }),
  );

  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
