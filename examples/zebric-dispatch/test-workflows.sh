#!/bin/bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
CSRF_TOKEN="${CSRF_TOKEN:-dispatchtesttoken}"
COOKIE_JAR="$(mktemp)"
EMAIL="dispatch.$RANDOM@example.com"
PASSWORD="Test123!"

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

echo "Running Dispatch workflow smoke test against $BASE_URL"

# 1) Entity-trigger workflow: Request create -> ScoreRequestOnCreate -> status=triage
CREATE_RESPONSE="$(curl -s \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "content-type: application/json" \
  -X POST "$BASE_URL/api/requests" \
  -d '{"title":"Workflow test","description":"Entity trigger test","source":"manual"}')"

REQUEST_ID="$(echo "$CREATE_RESPONSE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [ -z "$REQUEST_ID" ]; then
  echo "Failed to create Request: $CREATE_RESPONSE"
  exit 1
fi

sleep 1
REQUEST_RESPONSE="$(curl -s "$BASE_URL/api/requests/$REQUEST_ID")"
if ! echo "$REQUEST_RESPONSE" | grep -q '"status":"triage"'; then
  echo "Expected status=triage after create workflow, got: $REQUEST_RESPONSE"
  exit 1
fi
echo "OK: create trigger workflow moved Request to triage"

# 2) Manual workflows require authenticated session
curl -s -c "$COOKIE_JAR" \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "content-type: application/json" \
  -X POST "$BASE_URL/api/auth/sign-up/email" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Dispatch Tester\"}" >/dev/null

curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "content-type: application/json" \
  -X POST "$BASE_URL/api/auth/sign-in/email" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null

# 3) Manual action workflow: SetRequestStatus -> planned
STATUS_ACTION="$(curl -s -b "$COOKIE_JAR" \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json" \
  -X POST "$BASE_URL/actions/SetRequestStatus" \
  -d "{\"entity\":\"Request\",\"recordId\":\"$REQUEST_ID\",\"payload\":{\"status\":\"planned\"}}")"

if ! echo "$STATUS_ACTION" | grep -q '"success":true'; then
  echo "SetRequestStatus action failed: $STATUS_ACTION"
  exit 1
fi

sleep 1
REQUEST_RESPONSE="$(curl -s "$BASE_URL/api/requests/$REQUEST_ID")"
if ! echo "$REQUEST_RESPONSE" | grep -q '"status":"planned"'; then
  echo "Expected status=planned after manual workflow, got: $REQUEST_RESPONSE"
  exit 1
fi
echo "OK: manual SetRequestStatus workflow updated Request to planned"

# 4) Manual action workflow: SetQuarterBucket -> RequestDecision row
BUCKET_ACTION="$(curl -s -b "$COOKIE_JAR" \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json" \
  -X POST "$BASE_URL/actions/SetQuarterBucket" \
  -d "{\"entity\":\"Request\",\"recordId\":\"$REQUEST_ID\",\"payload\":{\"quarterBucket\":\"committed\"}}")"

if ! echo "$BUCKET_ACTION" | grep -q '"success":true'; then
  echo "SetQuarterBucket action failed: $BUCKET_ACTION"
  exit 1
fi

sleep 1
DECISION_RESPONSE="$(curl -s "$BASE_URL/api/requestdecisions")"
if ! echo "$DECISION_RESPONSE" | grep -q "\"request_id\":\"$REQUEST_ID\""; then
  echo "Expected RequestDecision for request $REQUEST_ID, got: $DECISION_RESPONSE"
  exit 1
fi
if ! echo "$DECISION_RESPONSE" | grep -q '"quarter_bucket":"committed"'; then
  echo "Expected quarter_bucket=committed, got: $DECISION_RESPONSE"
  exit 1
fi
echo "OK: manual SetQuarterBucket workflow created RequestDecision"

echo "Dispatch workflow smoke test passed"
