#!/usr/bin/env bash
set -euo pipefail

REF=ezywmmfkobnjwwjzufvu
FN=https://$REF.supabase.co/functions/v1/prototype-upload-preview-cpu
BOOKS="${BOOKS:-alice moby-dick war-and-peace pride-and-prejudice}"
PARSERS="${PARSERS:-deno-dom parse5}"
STAGES="${STAGES:-download unzip hash parse sanitise extract}"
RUNS="${RUNS:-3}"

KEY=$(supabase projects api-keys --project-ref $REF -o json \
  | python3 -c "import sys,json; print([k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'][0])")

sign() {
  curl -s -X POST "https://$REF.supabase.co/storage/v1/object/sign/prototype-books/$1.zip" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d '{"expiresIn":3600}' \
    | python3 -c "import sys,json; print('https://$REF.supabase.co/storage/v1'+json.load(sys.stdin)['signedURL'])"
}

for book in $BOOKS; do
  url=$(sign "$book")
  for parser in $PARSERS; do
    for stage in $STAGES; do
      for run in $(seq 1 "$RUNS"); do
        body=$(python3 -c "
import json,sys
print(json.dumps({'book':'$book','zipUrl':sys.argv[1],'parser':'$parser','upto':'$stage','run':$run}))
" "$url")
        out=$(curl -s -w '\n%{http_code}' -X POST "$FN" -H 'Content-Type: application/json' -d "$body")
        code=$(echo "$out" | tail -1)
        payload=$(echo "$out" | sed '$d')
        echo "{\"book\":\"$book\",\"parser\":\"$parser\",\"upto\":\"$stage\",\"run\":$run,\"http\":$code,\"payload\":$( [ "$code" = "200" ] && echo "$payload" || echo "\"$(echo "$payload" | tr -d '\n' | sed 's/"/\\"/g')\"" )}"
      done
    done
  done
done
