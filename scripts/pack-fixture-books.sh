#!/usr/bin/env bash
#
# Zips each fixture Book under fixtures/books/ into fixtures/books/dist/, ready
# to upload through the app's own "Upload a zip holding index.html at its root"
# control. The source stays as plain index.html per Book — readable and
# diffable — and only the zip, which is what the app actually accepts, is a
# generated, gitignored artifact.
#
#   scripts/pack-fixture-books.sh

set -euo pipefail

cd "$(dirname "$0")/.."

SRC_DIR="fixtures/books"
DIST_DIR="$SRC_DIR/dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

for book_dir in "$SRC_DIR"/*/; do
  name="$(basename "$book_dir")"
  [[ "$name" == "dist" ]] && continue

  zip_path="$DIST_DIR/$name.zip"
  (cd "$book_dir" && zip -q -X -r "../../../$zip_path" index.html)
  echo "packed  $zip_path"
done
