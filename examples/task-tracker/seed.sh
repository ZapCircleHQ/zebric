#!/usr/bin/env bash
set -euo pipefail

# Seed a few sample tasks for the task-tracker example.
# Requires the server to be running (pnpm --filter task-tracker dev).
# The board columns are fixed in blueprint.toml — no seeding needed for them.

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

echo "Creating tasks..."
post_json /api/tasks '{"title":"Draft the Q3 roadmap","description":"Pull themes from the planning doc and circulate for feedback.","status":"not_started","priority":"high","dueDate":"2026-09-15","important":true,"position":0}' > /dev/null
post_json /api/tasks '{"title":"Renew the TLS certificate","description":"Expires end of month — rotate before the freeze.","status":"not_started","priority":"normal","dueDate":"2026-09-28","position":1}' > /dev/null
post_json /api/tasks '{"title":"Write the widget board guide","description":"Short walkthrough for the docs site.","status":"in_progress","priority":"normal","position":0}' > /dev/null
post_json /api/tasks '{"title":"Migrate the staging database","status":"in_progress","priority":"high","important":true,"position":1}' > /dev/null
post_json /api/tasks '{"title":"Archive last quarter'"'"'s tickets","status":"done","priority":"low","position":0}' > /dev/null

echo "Done. Open $BASE"
