# Fixture Books

Demo content for showing Marginly to people who aren't reading the code —
each one is a small, original, multi-chapter piece with real typography, sized
to read well in the app without being an actual full-length book on disk.

| Folder | Subject | Chapters | Words |
|---|---|---|---|
| `the-lighthouse-keeper` | literary fiction | 6 | ~1,400 |
| `field-notes-on-rivers` | essays | 5 | ~1,150 |

Each folder holds a single `index.html` — the exact shape the app's Upload
control expects at the root of a zip. Source stays as plain HTML so it's
readable and diffable in review; the zip the app actually accepts is
generated on demand:

```bash
scripts/pack-fixture-books.sh
```

This writes `fixtures/books/dist/<name>.zip` (gitignored — regenerate it
rather than committing it). Upload one through the Book page's "Upload a zip
holding index.html at its root" control the same way an Author would.
