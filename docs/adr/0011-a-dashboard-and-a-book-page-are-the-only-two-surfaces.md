# A dashboard and a Book page are the only two surfaces

`Readme.md:54` and `Readme.md:67` give both roles a dashboard of their Books and
each Book's Versions, and ADR-0001 makes that dashboard the only discovery route
in the product. ADR-0008 then added acts with nowhere to be: creating a Book,
renaming it, deleting it while it holds no Versions, granting a Reviewer access.

Marginly has **two surfaces**. A dashboard, and a Book page that *is* the reading
view. There is no third.

## The dashboard

One route for everyone. It holds two lists — Books I own, and Books shared with
me — because a role is a property of a Book rather than of an account. ADR-0010
keys a grant to an account id, and nothing stops the Author of one Book being a
Reviewer of another. Two routes would have needed a rule for the person who is
both; one flat list with a role marker would have read as one collection when the
two carry different acts.

A row is the Book's name, how many Versions it holds, and when the latest one was
Uploaded. Rows sort by that date, newest first, with zero-Version Books ordered
by when they were created. A zero-Version Book reads as having none, not as an
error.

Creating a Book lives here, because no Book page exists yet to hold it. It asks
for a name and nothing else, and on success the Author lands on the new Book's
page. ADR-0008's two acts stay distinct, and the name collision has one place to
appear. Asking for the name and the first zip together was rejected on the state
it does not remove: an Author who abandons the preview leaves a zero-Version Book
either way, so the empty case gets built regardless and would then arrive by
accident rather than by choice.

An Author with no Books is invited to create one. A person with nothing shared is
told plainly that nothing has been shared with them yet and that the Author will
be in touch — ADR-0001 leaves them no way to ask, and no email is coming.

**No Thread activity appears on the dashboard at all.** Not an unread count, and
not the derivable numbers either — no count of Open Threads, no timestamp of the
newest Comment. Unread state is a notifications feature wearing a badge: it needs
a last-seen mark per account per Book, which is a write on every read and a word
`CONTEXT.md` would have to carry, and ADR-0001 ruled notifications out. A bare
Open-Thread count survives that objection but fails a different one — it reads
like an unread badge while answering nobody's actual question, which for a
Reviewer is whether anyone replied to *them*. ADR-0001 already accepts that a
Reviewer never learns the Author answered; a number that looks like it says so
and does not is worse than silence.

## The Book page is the reading view

Opening a Book opens its latest Version, as ADR-0007 requires, and the Version
switcher moves between Versions from there.

**A Book has one address.** Switching Versions changes what is on screen and not
the address. A separate overview page — Book metadata and a Version list at
`/books/:id`, reading one click further in — was rejected for adding a third
surface to a product with two, and per-Version addresses were rejected with it:
what an Author means when they nudge a Reviewer out of band (ADR-0001) is this
Book as it stands, and that is the only link that exists. ADR-0005's Version
assets keep their own addresses, but those are asset routes behind an access
check, not reading routes.

The cost is real and accepted: a Version cannot be linked to, a reload returns
the reader to latest, and browser back leaves the Book rather than stepping
through Versions.

## The header bar

A thin bar Marginly owns, above the Book's content: the Book's name, the Version
switcher, and the acts. For an Author, Upload, rename, People, and — only while
the Book holds no Versions — delete. For a Reviewer, the name, the switcher, and
People.

**The Book's acts work while reading any Version.** Rename, People and Upload are
about the Book rather than the Version on screen, so hiding them on an older
Version would be a rule with no reason behind it. An Upload always lands as the
next Version after the latest, never after the one being read. Absence on an
older Version therefore keeps meaning exactly what ADR-0007 made it mean — no
composer, no Resolve, no drag — and means one thing only.

The bar names the current Version and never its position: `Version 2`, never
`Version 2 of 7` and never a count of what followed. The switcher, opened
deliberately, lists every Version with its Upload date and **marks the newest as
the latest**. That marker amends ADR-0007, which had the switcher merely listing
Versions: ADR-0003's rule is that the page must not volunteer how much came
after, and a switcher the reader chose to open is not the page volunteering.
Without the marker, returning to latest is a guess.

Rename opens a small dialog with the current name filled in, and ADR-0008's
collision refusal appears beside the field — the same shape as the create form on
the dashboard, so one refusal path is built once and used twice. Editing the name
in place was rejected because a rejected name has nowhere to be shown: it either
sits there looking saved or reverts unexplained.

Delete is present only while the Book holds no Versions and is gone once v1 lands
(ADR-0008). Leaving it visible to refuse with a reason would teach the rule at
the moment it is asked about, but it puts a destructive act that never works on
almost every Book in the product.

A zero-Version Book is the same page, with a single prompt to Upload the first
Version where the text would be. One page shape for every Book, so the switcher,
rename and delete are each in their usual place, and ADR-0008's refusal to grant
access before v1 has somewhere visible to happen.

## People, and what ADR-0010 got wrong about revoking

A People act in the bar opens a panel listing the Author and every Reviewer who
has not been revoked. The Author gets a field to grant by email address and a
revoke beside each Reviewer; a Reviewer gets neither. Both roles reach the panel,
which `Readme.md` never asked for and ADR-0010 already permits — it makes a
Book's Reviewer list readable by everyone on the Book, on the grounds that seeing
who else is reviewing is the disclosure `Readme.md:73` already requires.

ADR-0010 assumed revoking exists and described it twice, inconsistently. It says
a grant is a row and "revoking is deleting the row", and it also promises that a
revoked Reviewer's address stays visible beside the Comments they wrote. Those
cannot both hold: that ADR reads an address only where the reader and the subject
share a Book, and deleting the row ends the sharing, so the name under a revoked
Reviewer's Comments would disappear the moment access did. The promise was the
right one — words other people replied to need their author — so the mechanism
changes.

**A grant row is never deleted. Revoking marks it.**

- `can_read_book` counts only unmarked rows, so reading stops at the revoke.
- The `public.users` read accepts any grant row, marked or not, so a revoked
  Reviewer's address stays readable to everyone still on the Book.
- `grant_access`'s "already granted" refusal narrows to *granted and not
  revoked*. Granting an address whose row is marked clears the mark and access
  returns, so the Author types an address and gets access either way without
  needing to know whether that person was ever here before.

Widening the identity rule to "shares a Book, or wrote a Comment on it" was the
alternative that keeps the grant table holding only live access. It was rejected
for making every address read a join over `comments`, and for erasing a Reviewer
who was granted and revoked without ever commenting — there would be no record
they had been there. Copying the address onto each Comment at write time was
rejected for storing the same identity twice where the two can disagree, and for
printing an address permanently in a Thread after it changes hands, which is the
failure ADR-0010 keyed grants on account ids to avoid.

Revoking is the one act here `Readme.md` does not list. It is in because ADR-0010
wrote it down twice already, not as an addition to scope.

## Consequences

**Every act has exactly one home, and the bar is that home.** Two surfaces is a
constraint that will be pushed on by the next act anyone thinks of, and the
answer is the bar or the dashboard's create — not a settings page.

**Issue 12 grows.** ADR-0007 left it open how a Book's CSS is kept out of
Marginly's interface, and that interface is now controls the Author acts through,
not only cards they read. A Book's stylesheet reaching a rename dialog or a
revoke is a correctness problem, not a cosmetic one.

**The switcher's state is not shareable and not durable.** One address per Book
means the Version being read exists only in the page. A reader who reloads while
comparing v2 to v5 starts over, and no link points at either.

**`book_reviewers` now carries two meanings of granted.** A row exists and a row
is live are different questions, and every policy, function and panel touching
that table has to say which one it wants. ADR-0010 warned about exactly this
shape when it rejected treating a revoked Reviewer as still sharing the Book; the
difference is that only two readers care — the access check wants live, the
identity read wants exists — and both are named here.

**Revoking is not eviction.** A Reviewer revoked while reading keeps the page in
front of them until their next request, which refuses. Nothing pushes them off,
and no live session invalidation is built.

**`CONTEXT.md` gains no word for any of this.** Dashboard, Book page and header
bar are surfaces, not domain concepts, and naming them in the glossary would make
it a description of the interface. The one change is to Reviewer, which now says
access may be withdrawn — a Reviewer whose access ends is still the person who
wrote those Comments, so no second term is coined for them.
