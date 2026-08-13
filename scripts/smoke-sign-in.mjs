#!/usr/bin/env node
//
// The sign-in flow, end to end, against a running app.
//
// `npm run verify` proves the pure seams and the policies, and it deliberately needs no
// app server. This proves the part only a running server can: a real magic link, out of
// the real mailer, through the real /auth/confirm route, landing on a page that reads
// the address back out of public.users under RLS.
//
// It matters most where the unit tests are blindest. Every sign-in failure except the
// rate limit deliberately answers "a link is on its way" (an address with no account
// must not be distinguishable), so a genuinely broken send looks exactly like a working
// one from the outside. This is what tells them apart.
//
//   npm run start            # or bash scripts/restart-app.sh
//   npm run smoke
//
// Environment:
//   APP_URL   where the app is serving (default http://127.0.0.1:3000)

import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const PERSON = "smoke-check@example.com";

const steps = [];
let failed = false;

function check(name, ok, detail = "") {
  steps.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function readStack() {
  return JSON.parse(
    execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }),
  );
}

let stack = readStack();

/**
 * Ask for a magic link and read back what the mailer actually holds.
 *
 * Returns the message and the /auth/confirm link in it, either of which may be absent —
 * judging them is the caller's job, because this runs more than once.
 */
/**
 * Wait until a service answers.
 *
 * `supabase start` returns before every container is accepting connections, so a restart
 * followed straight away by a request gets a closed socket rather than a result. Polling
 * here is what makes the repair path below survive its own restart.
 */
async function waitUntilReady(url, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;

  for (;;) {
    try {
      if ((await fetch(url)).ok) {
        return true;
      }
    } catch {
      // Not up yet. Fall through to the deadline check and try again.
    }

    if (Date.now() > deadline) {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function requestLink() {
  const mailbox = stack.MAILPIT_URL ?? stack.INBUCKET_URL;

  if (!(await waitUntilReady(`${mailbox}/api/v1/messages?limit=1`))) {
    console.error(`The mailer at ${mailbox} never came up.`);
    process.exit(1);
  }

  // The account has to exist: there is no sign-up (ADR-0001). Seeding is idempotent.
  execFileSync("node", ["scripts/seed-accounts.mjs", "--local", PERSON], {
    stdio: "pipe",
  });

  const anon = createClient(stack.API_URL, stack.ANON_KEY, {
    auth: { persistSession: false },
  });

  await fetch(`${mailbox}/api/v1/messages`, { method: "DELETE" });

  const { error: sendError } = await anon.auth.signInWithOtp({
    email: PERSON,
    options: { shouldCreateUser: false },
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const { messages } = await (await fetch(`${mailbox}/api/v1/messages?limit=1`)).json();
  const message = messages[0];

  const body = message
    ? await (await fetch(`${mailbox}/api/v1/message/${message.ID}`)).json()
    : {};
  const link = `${body.HTML ?? ""} ${body.Text ?? ""}`.match(
    /https?:\/\/[^"'\s<>]*\/auth\/confirm[^"'\s<>]*/,
  );

  return { sendError, messages, message, link };
}

/**
 * The stack has to be serving *this repo's* email template, and a fresh checkout is not
 * enough to guarantee it.
 *
 * The CLI bind-mounts supabase/templates/magic-link.html into kong at `supabase start`.
 * Rewrite that file — any editor that saves by replacing rather than truncating does —
 * and the mount dangles: kong answers 404 and gotrue quietly falls back to its **own**
 * template. That template still sends a real, working-looking email. It just points at
 * /auth/v1/verify rather than the /auth/confirm route the app actually serves, so sign-in
 * is broken and the only symptom is a subject line nobody reads.
 *
 * Inheriting that state is what makes this check pass one day and fail the next against
 * identical code, which is worse than being slow. So the setup **converges** the stack
 * instead of assuming it: run the thing, and if the wrong template answered, restart once
 * and run it again. A restart is the only repair available — a bind mount cannot be
 * remade under a running container.
 *
 * The signal is the email itself rather than a probe at kong. Kong serves the template on
 * an internal port that is not published to the host, so a probe would have to know
 * container names and ports and would go stale the moment the CLI rearranges either.
 */
let attempt = await requestLink();

if (attempt.message?.Subject !== "Your Marginly sign-in link") {
  console.log("The stack answered with the wrong email template. Restarting it.");
  execFileSync("supabase", ["stop"], { stdio: "pipe" });
  execFileSync("supabase", ["start"], { stdio: "pipe" });
  stack = readStack();
  attempt = await requestLink();
}

const { sendError, messages, message, link: linkMatch } = attempt;

// 1. Ask for a link, the way the sign-in form's action does.
check("a magic link is sent for a seeded address", !sendError, sendError?.message ?? "");

// 2. The mailer holds it, rendered from our own template.
check("the mailer holds exactly one new message", messages.length === 1);
check(
  "it is Marginly's own template",
  message?.Subject === "Your Marginly sign-in link",
  message?.Subject ?? "no message",
);

check("the link carries a token hash to /auth/confirm", linkMatch !== null);

if (linkMatch) {
  const link = linkMatch[0].replace(/&amp;/g, "&");

  // 3. Follow it as a browser would, keeping the cookies it sets.
  const confirm = await fetch(link, { redirect: "manual" });
  const jar = confirm.headers.getSetCookie().map((c) => c.split(";")[0]);
  check("the confirm route verifies it and sets a session", jar.length > 0, `${confirm.status}`);

  // 4. The signed-in page shows the address, read from public.users under RLS.
  const home = await fetch(`${APP_URL}/`, {
    headers: { cookie: jar.join("; ") },
    redirect: "manual",
  });
  const html = await home.text();
  check("the signed-in page shows the address", html.includes(PERSON), `${home.status}`);

  // 5. A used link is refused, with the one generic problem.
  const reused = await fetch(link, { redirect: "manual" });
  const reusedTo = reused.headers.get("location") ?? "";
  check("a reused link is refused generically", reusedTo.includes("error=link"), reusedTo);
}

// 6. A signed-out request never reaches a signed-in page.
const signedOut = await fetch(`${APP_URL}/`, { redirect: "manual" });
const signedOutTo = signedOut.headers.get("location") ?? "";
check(
  "a signed-out request is sent to sign in",
  signedOutTo.endsWith("/sign-in"),
  `${signedOut.status} ${signedOutTo}`,
);

console.log();
console.log(
  failed
    ? `FAILED — ${steps.filter((s) => !s.ok).length} of ${steps.length} checks`
    : `All ${steps.length} checks passed.`,
);
process.exit(failed ? 1 : 0);
