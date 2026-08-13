# Presenting the demo

The execution half of [`browser-demo`](SKILL.md). The approved `demo-<date>.md` is the script; this file is how you perform it.

## Stage before you present

Run section 3 of the plan to completion first, with no narration — the audience watches the demo, not the setup.

1. Start the app; confirm the base URL serves.
2. Create every fixture; verify each exists by reading it back, not by trusting the command's exit code.
3. Open the **tab group**: create the group with the plan's name and colour, then open the plan's tabs into it in load order, ending on the tab beat 1 starts from. If the browser tool surface has no group-create tool, open the tabs into one fresh window and say the group's name in the opening narration.
4. Ask the user for the staging **hand-offs** from section 4 of the plan — the sign-ins, grants, and settings that have to be true before beat 1. Ask for them in one message, so they make a single pass at the keyboard instead of being interrupted repeatedly, and wait for each observable before treating it as done.
5. Take one screenshot of the opening tab and check it against what beat 1 expects to see.

Then tell the user staging is complete and the demo starts on their word. Wait for it.

## The presentation loop

For each beat in the sheet, in order:

1. **Narrate** — print the beat's narration as terminal text before acting, in the present tense, as the person using the app ("I'm opening the reviewer's thread to see what changed"). One to three sentences.
2. **Act** — fire the beat's single browser call against the beat's target.
3. **Pause** — hold the beat's tempo (below) so the audience's eyes can follow.
4. **Confirm** — for beats with a Confirm column, take the screenshot or page read and say in one line what the audience should now see on screen.

Strike the beat off in `demo-<date>.md` as you complete it, so the sheet is a live record of where the demo stands.

### Hand-off beats

A beat whose Action is `hand-off` swaps step 2: narrate it, then ask the user to do it themselves and stop until they have. Say what you need them to do, why it is theirs, and what you are watching for — "this one's yours: sign in as the reviewer, and tell me when the dashboard is up." Then wait. Do not fill the silence with other beats, and do not attempt the action yourself when the wait feels long.

An unplanned hand-off can appear mid-demo — a login page you did not expect, a consent banner, a bot check, a payment step. Treat it exactly the same way: name it to the audience, hand it to the user, wait, then carry on from the next beat. Anything that authenticates, pays, consents, publishes, or deletes is theirs even when the plan failed to predict it.

If they decline or cannot do it, mark that feature blocked with the reason and move to the next one, the same as any other blocked feature.

## Human tempo

A person hesitates, reads, and types in bursts. Hold these with `sleep` between beats (if `sleep` is refused, use `Monitor` with an until-loop):

| Moment | Hold |
|--------|------|
| Between clicks inside one flow | 1–2s |
| After a click that opens a page, panel, or menu | 2–4s, so the audience reads it |
| Typing into a field | type in phrase-sized chunks with 0.5–1s between them, never one instant paste |
| After submitting anything that writes | 3–5s, then confirm |
| Between two features | 5s, filled with narration linking them |
| Before a beat you want remembered | an extra 2s of silence after the narration, before the click |

Read the screen out loud at the pace someone reading it would: a beat that lands on a dense page earns a longer hold than one that lands on a button.

## Going off-script

The live app will diverge from the sheet — a slow load, a changed label, an empty list. When a beat's target is missing or its Confirm fails:

1. Screenshot and read the page to find what the app is actually showing.
2. Say plainly what you see and that you are adjusting — the audience trusts a presenter who narrates the surprise.
3. Take the plan's off-script recovery for that feature if one applies; otherwise reach the beat's goal by another visible path and carry on.
4. Note the divergence in the sheet as off-script with the reason.

Retry a failed beat once. On a second failure, mark the feature blocked with what you saw, and move to the next feature so the rest of the demo still lands.

## Close

1. Say one closing line per feature: what the audience just saw it do.
2. Run the plan's teardown — reset commands, then close the demo tabs and the tab group. Ask the user for any teardown step that is theirs: signing out of a real account, revoking a grant.
3. Report: beats presented, beats off-script with reasons, features blocked, hand-offs performed and any the user declined, and fixtures left behind if teardown could not remove them.

## Completion criterion

Every beat in `demo-<date>.md` is marked struck, off-script with a reason, or blocked with what you saw — and the report names each off-script and blocked one to the user. Every hand-off, planned or not, was performed by the user rather than by you.
