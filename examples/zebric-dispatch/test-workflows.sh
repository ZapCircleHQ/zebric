#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
AGENT_KEY="${DISPATCH_AGENT_API_KEY:?Set DISPATCH_AGENT_API_KEY to the key used by the running server}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DispatchDemo1!}"
RUN_ID="dispatch-smoke-$(date +%s)"
OPERATOR_COOKIES="$(mktemp)"
APPROVER_COOKIES="$(mktemp)"
trap 'rm -f "$OPERATOR_COOKIES" "$APPROVER_COOKIES"' EXIT

json_id() { python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])'; }
first_id() { python3 -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["id"] if rows else "")'; }

agent_post() {
  curl -fsS -X POST "$BASE_URL$1" -H "authorization: Bearer $AGENT_KEY" \
    -H "x-agent-run-id: $RUN_ID" -H "idempotency-key: $RUN_ID-$2" \
    -H "content-type: application/json" -d "$3"
}

sign_in() {
  local email="$1" jar="$2" csrf="dispatch-smoke-csrf"
  curl -fsS -c "$jar" -H "Cookie: csrf-token=$csrf" -H "x-csrf-token: $csrf" \
    -H "Origin: $BASE_URL" -H "content-type: application/json" -X POST \
    "$BASE_URL/api/auth/sign-in/email" -d "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\"}" >/dev/null
}

human_action() {
  local workflow="$1" jar="$2" request_id="$3" payload="${4:-}" csrf="dispatch-smoke-csrf"
  if [[ -z "$payload" ]]; then payload='{}'; fi
  curl -fsS -X POST "$BASE_URL/actions/$workflow" -b "$jar" \
    -H "Cookie: csrf-token=$csrf" -H "x-csrf-token: $csrf" -H "accept: application/json" \
    --data-urlencode "entity=Request" --data-urlencode "recordId=$request_id" \
    --data-urlencode "page=/requests/:id" --data-urlencode "redirect=/requests/$request_id" \
    --data-urlencode "payload=$payload"
}

echo "Creating a protected request as an attributed agent..."
CREATE="$(agent_post /api/agent/requests create '{"categoryId":"cat_access","title":"Smoke test protected access","description":"Exercise the governed human-agent handoff.","priority":"normal"}')"
REQUEST_ID="$(printf '%s' "$CREATE" | json_id)"
sleep 1

sign_in "priya@dispatch.local" "$OPERATOR_COOKIES"
human_action TriageRequest "$OPERATOR_COOKIES" "$REQUEST_ID" '{}' >/dev/null
sleep 1

agent_post "/api/agent/requests/$REQUEST_ID/comments" comment '{"body":"Confirmed the least-privilege role; stopping for human approval."}' >/dev/null
agent_post "/api/agent/requests/$REQUEST_ID/request-approval" approval '{"requestedFromId":"demo-approver","requestedFromName":"Jeff Morgan","reason":"Production access requires a human decision."}' >/dev/null
sleep 1

BEFORE="$(curl -fsS "$BASE_URL/api/agent/requests/$REQUEST_ID" -H "authorization: Bearer $AGENT_KEY")"
printf '%s' "$BEFORE" | grep -q '"approvalState":"pending"'
printf '%s' "$BEFORE" | grep -q '"status":"waiting"'
echo "OK: agent reached the approval boundary and stopped."

APPROVALS="$(curl -fsS "$BASE_URL/api/agent/requests/$REQUEST_ID/approvals" -H "authorization: Bearer $AGENT_KEY")"
APPROVAL_ID="$(printf '%s' "$APPROVALS" | first_id)"
test -n "$APPROVAL_ID"

sign_in "jeff@dispatch.local" "$APPROVER_COOKIES"
human_action ApproveRequest "$APPROVER_COOKIES" "$REQUEST_ID" "{\"approvalId\":\"$APPROVAL_ID\"}" >/dev/null
sleep 1

agent_post "/api/agent/requests/$REQUEST_ID/comments" result '{"body":"Human approval observed. Provisioned the read-only role and verified access."}' >/dev/null
agent_post "/api/agent/requests/$REQUEST_ID/complete" complete '{}' >/dev/null
sleep 1

AFTER="$(curl -fsS "$BASE_URL/api/agent/requests/$REQUEST_ID" -H "authorization: Bearer $AGENT_KEY")"
printf '%s' "$AFTER" | grep -q '"approvalState":"approved"'
printf '%s' "$AFTER" | grep -q '"status":"completed"'

ACTIVITY="$(curl -fsS "$BASE_URL/api/agent/requests/$REQUEST_ID/activity" -H "authorization: Bearer $AGENT_KEY")"
printf '%s' "$ACTIVITY" | grep -q '"actorType":"agent"'
printf '%s' "$ACTIVITY" | grep -q '"eventType":"approval.approved"'
echo "OK: human approval released the agent, which completed the same request."
echo "Dispatch workflow smoke test passed: $BASE_URL/requests/$REQUEST_ID"
