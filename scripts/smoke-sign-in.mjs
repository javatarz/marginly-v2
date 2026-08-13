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

const stack = JSON.parse(
  execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8" }),
);
const mailbox = stack.MAILPIT_URL ?? stack.INBUCKET_URL;

// The account has to exist: there is no sign-up (ADR-0001). Seeding is idempotent.
execFileSync("node", ["scripts/seed-accounts.mjs", "--local", PERSON], {
  stdio: "pipe",
});

const anon = createClient(stack.API_URL, stack.ANON_KEY, {
  auth: { persistSession: false },
});

await fetch(`${mailbox}/api/v1/messages`, { method: "DELETE" });

// 1. Ask for a link, the way the sign-in form's action does.
const { error: sendError } = await anon.auth.signInWithOtp({
  email: PERSON,
  options: { shouldCreateUser: false },
});
check("a magic link is sent for a seeded address", !sendError, sendError?.message ?? "");

// 2. The mailer holds it, rendered from our own template.
await new Promise((resolve) => setTimeout(resolve, 1500));
const { messages } = await (
  await fetch(`${mailbox}/api/v1/messages?limit=1`)
).json();
const message = messages[0];
check("the mailer holds exactly one new message", messages.length === 1);
check(
  "it is Marginly's own template",
  message?.Subject === "Your Marginly sign-in link",
  message?.Subject ?? "no message",
);

const body = message
  ? await (await fetch(`${mailbox}/api/v1/message/${message.ID}`)).json()
  : {};
const linkMatch = `${body.HTML ?? ""} ${body.Text ?? ""}`.match(
  /https?:\/\/[^"'\s<>]*\/auth\/confirm[^"'\s<>]*/,
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
