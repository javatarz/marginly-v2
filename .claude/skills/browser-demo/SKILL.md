---
name: browser-demo
description: Plan and present a live click-by-click browser demo of named features, driven through Claude in Chrome at human tempo.
argument-hint: <feature> [, <feature> ...] — features to demo, in story order
disable-model-invocation: true
---

# Browser demo

Present named features to a watching human by driving a real Chrome window: one **beat** at a time, narrated as it happens, paced like a person using the product.

A **beat** is the atom of the whole skill — one narration line, one browser action, one pause, and (when the beat makes a visible claim) one confirmation. Beats are what you plan, what you strike off, and what you count when you report.

The skill argument names the features to demo. Treat it as the scope: every feature named gets beats, and features it does not name stay out of the run.

This file plans. `RUN.md` presents. Write the whole plan and get it approved before reading `RUN.md`.

## Preconditions

Check all three before planning:

1. **Browser tools reachable.** Load the Claude in Chrome tool surface — `ToolSearch("+chrome tab")`, then whatever else the names suggest (navigate, click, type, read page, screenshot, tab groups). Record the exact tool names you found in the plan's Toolbelt section; the plan is written against the names that exist today, not remembered ones.
2. **App reachable.** Find this project's one-command launcher (its README, `package.json` scripts, compose file, `supabase/config.toml`) — the single command that rebuilds and relaunches the app in step with the checked-out commit, migrations included — and get the base URL. `RUN.md` runs this launcher fresh every time; never assume a server already running is current.
3. **Chrome connected.** If step 1 finds no browser tools, tell the user to connect Claude in Chrome (`/chrome`) and stop here. Everything downstream is browser work.

## Read the product first

Demo narration is only as good as the domain language behind it. Before writing beats, read the project's domain docs (`CLAUDE.md`, `CONTEXT.md`, `docs/adr/`, the feature's own code) and use their vocabulary in every narration line. A demo that renames the product's concepts teaches the audience the wrong words.

## Write the plan

Get today's date from the shell (`date +%F`) and write `demo-<date>.md` in the repo root. The plan is the script you will read aloud from, so write it complete enough that a different presenter could run it cold.

Sections, in order:

### 1. Audience and story

Who watches, what they should believe by the end, and the one-sentence spine linking the features in the argument into a single journey rather than a feature list.

### 2. Toolbelt

The exact browser tool names from Precondition 1, each with the one job you will use it for.

### 3. Environment and fixtures

The **staging** work — everything that must be true before beat 1 so the demo lands on a populated, believable app:

- Base URL, and the one-command launcher that rebuilds and relaunches the app (migrations included) — never a bare `next start` or a server already running.
- Accounts and credentials, including how each is created.
- Every data fixture the demo touches, each with the exact shell command, SQL, or seed script that creates it — and the reset command that returns the app to this state.
- Browser state: a fresh Incognito/Guest window or cleared cache and cookies for the app's origin, then which tabs the **tab group** holds, in load order, with the group's name and colour.
- Timers, quotas, or rate limits that can bite mid-demo (email-per-hour caps, token expiry), and what you do when one fires.

Every fixture needs a creation step written out. A fixture named without a way to create it is the plan's most common hole.

### 4. Hand-offs

A **hand-off** is a step the user performs at their own keyboard while you wait. Some belong to them because only a human should do them, some because only a human can.

These are theirs, every time:

- Passwords, one-time codes, API keys, and anything else that authenticates.
- Payment details, and any purchase or transfer.
- Personal data typed into a form, and the submit that sends it.
- Creating an account, accepting terms, granting an OAuth or extension permission, answering a consent banner.
- A CAPTCHA or other bot check.
- Anything outward-facing or hard to undo: sending a message, publishing, deleting real data.
- Browser, extension, or system settings.
- Anything the user said they want to do themselves.

List each one as a row: when it happens (during staging, or at which beat), the exact words you will use to ask, and the observable that tells you they are done and you may resume. Some hand-offs are staging — a sign-in that has to happen before beat 1 — and some are beats in front of the audience, which is fine: a presenter saying "I'll let you put your password in" reads as normal.

Where a hand-off can be avoided rather than performed, prefer avoiding it: a pre-seeded test account the user named, a fixture created by command, a demo route that skips the paywall. Plan the hand-off for what genuinely needs their hands.

### 5. Beat sheet

One numbered table row per beat, grouped under a heading per feature:

| # | Narration | Action | Target | Confirm |
|---|-----------|--------|--------|---------|
| 3 | "Now I'll upload the annotated PDF the reviewer sent back." | click | `Upload` button, page header | screenshot shows file picker |

- **Narration** — the words you will say, written out. Say what the user is trying to do and why it matters, then what to watch on screen.
- **Action** — one browser interaction, or `hand-off` when the user acts instead of you. A beat that needs two clicks is two beats.
- **Target** — how the element is identified: visible label, role, position on the page. Enough that you can find it in a screenshot without guessing.
- **Confirm** — the observable that proves the beat worked, only for beats that claim a visible result. Beats that merely move the cursor along skip it.

### 6. Teardown

The reset commands from section 3, plus which tabs and tab groups close. Mark any teardown step that is itself a hand-off — signing out of a real account, revoking an access grant.

### 7. Off-script plan

Per feature: the one or two ways it most plausibly misbehaves live, and the recovery you would take. Written in advance, because live is the worst time to invent one.

## Completion criterion

The plan is done when:

- Every feature in the skill argument has its own beat-sheet heading.
- Every beat has all five columns filled, with narration written as spoken words.
- Every fixture in section 3 has a creation command and appears in the reset command.
- Every browser tool named in a beat appears in the Toolbelt.
- Every step that touches credentials, payment, consent, a bot check, settings, or anything hard to undo appears in section 4 as a hand-off, with the words to ask and the observable that resumes the demo.

Walk the sheet once against this list and fix what it catches.

## Gate

Show the user the beat count, the fixture list, the hand-offs they will be asked to perform and when, and the total estimated run time. Ask them to approve or amend the plan.

On approval, read `RUN.md` and present.
