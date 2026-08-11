# Accounts are precreated and Book access is granted by the Author

Every Author and Reviewer account is created up front by an operator running a
seed script — there is no sign-up flow, and inviting a Reviewer to a Book grants
an account that already exists access to it, keyed by email address. No
invitation email is sent; a Reviewer discovers a Book they have been granted,
and any reply to their Comments, by signing in and looking at their dashboard.

## Considered Options

Sending an invitation email alongside the grant was the alternative, and it is
the obvious design: magic-link sign-in already means sending mail, so one more
message costs almost nothing and closes the discovery loop. It was rejected
because notifications are out of scope for this effort — nothing outside
`Readme.md` is in it — and an invitation email is the thin end of a
notifications feature that would then need reply notifications, digests, and
preferences to be coherent.

## Consequences

The dashboard is the **only** discovery surface in the product. A Reviewer who
never signs in never learns that a Book was shared with them or that the Author
answered them, and there is no mechanism that will tell them. Onboarding a
Reviewer therefore requires an out-of-band nudge from the Author.

Because accounts must exist before access can be granted, the seed script is on
the critical path for any manual testing of the invite flow.
