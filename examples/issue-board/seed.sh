#!/usr/bin/env bash
set -euo pipefail

# Seed sample data for the issue-board example.
# Requires the server to be running at http://localhost:3000.

BASE="${BASE:-http://localhost:3000}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# Prime the CSRF cookie by visiting the app.
curl -sS -c "$COOKIE_JAR" "$BASE/" > /dev/null
CSRF="$(grep csrf-token "$COOKIE_JAR" | awk '{print $NF}')"

post_json() {
  curl -sS -X POST "$BASE$1" \
    -b "$COOKIE_JAR" \
    -H "x-csrf-token: $CSRF" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$2"
}

extract_id() {
  python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])'
}

echo "Creating columns..."
BACKLOG=$(post_json /api/columns '{"name":"Backlog","position":0}' | extract_id)
INPROGRESS=$(post_json /api/columns '{"name":"In Progress","position":1}' | extract_id)
DONE=$(post_json /api/columns '{"name":"Done","position":2}' | extract_id)

echo "  Backlog     $BACKLOG"
echo "  In Progress $INPROGRESS"
echo "  Done        $DONE"

echo "Creating issues..."
post_json /api/issues "{\"title\":\"Wire widget schema into the blueprint parser\",\"columnId\":\"$DONE\",\"position\":0,\"important\":true}" >/dev/null
post_json /api/issues "{\"title\":\"Ship a working board widget end-to-end\",\"columnId\":\"$INPROGRESS\",\"position\":0,\"important\":true}" >/dev/null
post_json /api/issues "{\"title\":\"Drag-and-drop between columns\",\"columnId\":\"$INPROGRESS\",\"position\":1,\"important\":false}" >/dev/null
post_json /api/issues "{\"title\":\"Sortable list widget\",\"columnId\":\"$BACKLOG\",\"position\":0,\"important\":false}" >/dev/null
post_json /api/issues "{\"title\":\"Calendar widget\",\"columnId\":\"$BACKLOG\",\"position\":1,\"important\":false}" >/dev/null
post_json /api/issues "{\"title\":\"Tree/hierarchy widget\",\"columnId\":\"$BACKLOG\",\"position\":2,\"important\":false}" >/dev/null

echo "Done. Open $BASE in your browser."
