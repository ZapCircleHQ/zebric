#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DispatchDemo1!}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${DB_PATH:-$SCRIPT_DIR/data/app.db}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT
CSRF_TOKEN="${CSRF_TOKEN:-dispatch-seed-csrf}"

post_json() {
  curl -fsS -X POST "$BASE_URL$1" -b "$COOKIE_JAR" \
    -H "Cookie: csrf-token=$CSRF_TOKEN" -H "x-csrf-token: $CSRF_TOKEN" \
    -H "content-type: application/json" -H "accept: application/json" -d "$2"
}

put_json() {
  curl -fsS -X PUT "$BASE_URL$1" -b "$COOKIE_JAR" \
    -H "Cookie: csrf-token=$CSRF_TOKEN" -H "x-csrf-token: $CSRF_TOKEN" \
    -H "content-type: application/json" -H "accept: application/json" -d "$2"
}

post_auth() {
  curl -sS -X POST "$BASE_URL$1" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "Cookie: csrf-token=$CSRF_TOKEN" -H "x-csrf-token: $CSRF_TOKEN" \
    -H "Origin: $BASE_URL" -H "content-type: application/json" -H "accept: application/json" -d "$2"
}

extract_id() { python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])'; }

echo "Provisioning Dispatch demo identities..."
post_auth /api/auth/sign-up/email "{\"email\":\"alice@dispatch.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Alice Chen\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"priya@dispatch.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Priya Shah\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"jeff@dispatch.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Jeff Morgan\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"admin@dispatch.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Morgan Lee\"}" >/dev/null || true

sqlite3 "$DB_PATH" <<SQL
UPDATE user SET role = 'requester' WHERE email = 'alice@dispatch.local';
UPDATE user SET role = 'operator' WHERE email = 'priya@dispatch.local';
UPDATE user SET role = 'approver' WHERE email = 'jeff@dispatch.local';
UPDATE user SET role = 'admin' WHERE email = 'admin@dispatch.local';
SQL

ALICE_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='alice@dispatch.local' LIMIT 1;")"
PRIYA_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='priya@dispatch.local' LIMIT 1;")"
JEFF_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='jeff@dispatch.local' LIMIT 1;")"

post_auth /api/auth/sign-in/email "{\"email\":\"admin@dispatch.local\",\"password\":\"$DEMO_PASSWORD\"}" >/dev/null

if curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/requestcategorys" | grep -q 'cat_general'; then
  echo "Dispatch demo data already exists; leaving it unchanged."
  exit 0
fi

echo "Creating request categories..."
post_json /api/requestcategorys '{"id":"cat_general","name":"General Operations","slug":"general-operations","description":"Everyday internal operational work.","workflowKey":"general","active":true}' >/dev/null
post_json /api/requestcategorys '{"id":"cat_access","name":"Access & Permissions","slug":"access-permissions","description":"Access that requires a human authorization boundary.","workflowKey":"access","active":true}' >/dev/null
post_json /api/requestcategorys '{"id":"cat_it","name":"IT & Equipment","slug":"it-equipment","description":"Devices, workplace technology, and support.","workflowKey":"general","active":true}' >/dev/null
post_json /api/requestcategorys '{"id":"cat_engineering","name":"Engineering Operations","slug":"engineering-operations","description":"Operational engineering and infrastructure work.","workflowKey":"general","active":true}' >/dev/null
post_json /api/requestcategorys '{"id":"cat_purchasing","name":"Purchasing","slug":"purchasing","description":"Software and equipment purchases requiring approval.","workflowKey":"purchase","active":true}' >/dev/null
post_json /api/requestcategorys '{"id":"cat_people","name":"People Operations","slug":"people-operations","description":"Onboarding and internal people operations.","workflowKey":"general","active":true}' >/dev/null

echo "Creating a live operational queue..."
R1="$(post_json /api/requests "{\"id\":\"req_access_logs\",\"requestNumber\":\"DSP-1042\",\"title\":\"Grant production log access\",\"description\":\"Give our new engineer read-only access to production logs. Confirm the least-privilege IAM role before provisioning.\",\"status\":\"waiting\",\"priority\":\"high\",\"categoryId\":\"cat_access\",\"workflowKey\":\"access\",\"approvalState\":\"pending\",\"requesterId\":\"$ALICE_ID\",\"requesterName\":\"Alice Chen\",\"assigneeId\":\"$PRIYA_ID\",\"assigneeName\":\"Priya Shah\"}" | extract_id)"
R2="$(post_json /api/requests "{\"id\":\"req_figma\",\"requestNumber\":\"DSP-1043\",\"title\":\"Purchase three Figma licenses\",\"description\":\"Add three editor seats for the product design contractors through the end of the quarter.\",\"status\":\"waiting\",\"priority\":\"normal\",\"categoryId\":\"cat_purchasing\",\"workflowKey\":\"purchase\",\"approvalState\":\"pending\",\"requesterId\":\"$PRIYA_ID\",\"requesterName\":\"Priya Shah\",\"assigneeId\":\"$PRIYA_ID\",\"assigneeName\":\"Priya Shah\"}" | extract_id)"
R3="$(post_json /api/requests "{\"id\":\"req_laptop\",\"requestNumber\":\"DSP-1044\",\"title\":\"Replace developer laptop\",\"description\":\"Current laptop has recurring thermal shutdowns during local builds.\",\"status\":\"in_progress\",\"priority\":\"high\",\"categoryId\":\"cat_it\",\"workflowKey\":\"general\",\"requesterId\":\"$ALICE_ID\",\"requesterName\":\"Alice Chen\",\"assigneeId\":\"$PRIYA_ID\",\"assigneeName\":\"Priya Shah\"}" | extract_id)"
R4="$(post_json /api/requests "{\"id\":\"req_import\",\"requestNumber\":\"DSP-1045\",\"title\":\"Investigate failed nightly import\",\"description\":\"The customer import stopped after processing account 838. Determine impact and restore the job.\",\"status\":\"triaged\",\"priority\":\"urgent\",\"categoryId\":\"cat_engineering\",\"workflowKey\":\"general\",\"requesterId\":\"$PRIYA_ID\",\"requesterName\":\"Priya Shah\",\"assigneeId\":\"$ALICE_ID\",\"assigneeName\":\"Alice Chen\"}" | extract_id)"
R5="$(post_json /api/requests "{\"id\":\"req_onboarding\",\"requestNumber\":\"DSP-1046\",\"title\":\"Provision accounts for new engineer\",\"description\":\"Create baseline accounts for Sam before Monday. Production access stays in its separate approval request.\",\"status\":\"new\",\"priority\":\"normal\",\"categoryId\":\"cat_people\",\"workflowKey\":\"general\",\"requesterId\":\"$PRIYA_ID\",\"requesterName\":\"Priya Shah\"}" | extract_id)"
R6="$(post_json /api/requests "{\"id\":\"req_staging\",\"requestNumber\":\"DSP-1047\",\"title\":\"Create staging environment\",\"description\":\"Create an isolated staging stack for the new billing integration.\",\"status\":\"in_progress\",\"priority\":\"normal\",\"categoryId\":\"cat_engineering\",\"workflowKey\":\"general\",\"requesterId\":\"$ALICE_ID\",\"requesterName\":\"Alice Chen\",\"assigneeId\":\"$ALICE_ID\",\"assigneeName\":\"Alice Chen\"}" | extract_id)"
R7="$(post_json /api/requests "{\"id\":\"req_credential\",\"requestNumber\":\"DSP-1048\",\"title\":\"Rotate shared API credential\",\"description\":\"Rotate the legacy reporting credential and update the two remaining consumers.\",\"status\":\"waiting\",\"priority\":\"urgent\",\"categoryId\":\"cat_access\",\"workflowKey\":\"access\",\"approvalState\":\"approved\",\"requesterId\":\"$PRIYA_ID\",\"requesterName\":\"Priya Shah\",\"assigneeId\":\"$ALICE_ID\",\"assigneeName\":\"Alice Chen\"}" | extract_id)"
R8="$(post_json /api/requests "{\"id\":\"req_github\",\"requestNumber\":\"DSP-1049\",\"title\":\"Add contractor to GitHub organization\",\"description\":\"Grant time-limited access to the mobile repositories for the audit engagement.\",\"status\":\"completed\",\"priority\":\"normal\",\"categoryId\":\"cat_access\",\"workflowKey\":\"access\",\"approvalState\":\"approved\",\"requesterId\":\"$PRIYA_ID\",\"requesterName\":\"Priya Shah\",\"assigneeId\":\"$ALICE_ID\",\"assigneeName\":\"Alice Chen\",\"completedAt\":\"2026-09-24T16:40:00Z\"}" | extract_id)"
R9="$(post_json /api/requests "{\"id\":\"req_software\",\"requestNumber\":\"DSP-1050\",\"title\":\"Review observability software purchase\",\"description\":\"Compare the proposed annual plan against current usage and the renewal budget.\",\"status\":\"triaged\",\"priority\":\"normal\",\"categoryId\":\"cat_purchasing\",\"workflowKey\":\"purchase\",\"requesterId\":\"$ALICE_ID\",\"requesterName\":\"Alice Chen\",\"assigneeId\":\"$PRIYA_ID\",\"assigneeName\":\"Priya Shah\"}" | extract_id)"
R10="$(post_json /api/requests "{\"id\":\"req_conference\",\"requestNumber\":\"DSP-1051\",\"title\":\"Set up conference room equipment\",\"description\":\"Install the camera and validate audio before Thursday all-hands.\",\"status\":\"completed\",\"priority\":\"low\",\"categoryId\":\"cat_it\",\"workflowKey\":\"general\",\"requesterId\":\"$PRIYA_ID\",\"requesterName\":\"Priya Shah\",\"assigneeId\":\"$ALICE_ID\",\"assigneeName\":\"Alice Chen\",\"completedAt\":\"2026-09-22T20:00:00Z\"}" | extract_id)"
R11="$(post_json /api/requests "{\"id\":\"req_offsite\",\"requestNumber\":\"DSP-1052\",\"title\":\"Book team offsite space\",\"description\":\"Find a room for 18 people near the office with video conferencing.\",\"status\":\"cancelled\",\"priority\":\"low\",\"categoryId\":\"cat_general\",\"workflowKey\":\"general\",\"requesterId\":\"$ALICE_ID\",\"requesterName\":\"Alice Chen\"}" | extract_id)"
R12="$(post_json /api/requests "{\"id\":\"req_benefits\",\"requestNumber\":\"DSP-1053\",\"title\":\"Update benefits enrollment guide\",\"description\":\"Revise the new-hire guide with the 2027 enrollment dates.\",\"status\":\"new\",\"priority\":\"normal\",\"categoryId\":\"cat_people\",\"workflowKey\":\"general\",\"requesterId\":\"$PRIYA_ID\",\"requesterName\":\"Priya Shah\"}" | extract_id)"

# InitializeRequest first assigns a collision-free DSP-<ULID> reference. Once those
# asynchronous creation workflows settle, give the fixed demo records shorter labels.
sleep 1
put_json "/api/requests/$R1" '{"requestNumber":"DSP-1042"}' >/dev/null
put_json "/api/requests/$R2" '{"requestNumber":"DSP-1043"}' >/dev/null
put_json "/api/requests/$R3" '{"requestNumber":"DSP-1044"}' >/dev/null
put_json "/api/requests/$R4" '{"requestNumber":"DSP-1045"}' >/dev/null
put_json "/api/requests/$R5" '{"requestNumber":"DSP-1046"}' >/dev/null
put_json "/api/requests/$R6" '{"requestNumber":"DSP-1047"}' >/dev/null
put_json "/api/requests/$R7" '{"requestNumber":"DSP-1048"}' >/dev/null
put_json "/api/requests/$R8" '{"requestNumber":"DSP-1049"}' >/dev/null
put_json "/api/requests/$R9" '{"requestNumber":"DSP-1050"}' >/dev/null
put_json "/api/requests/$R10" '{"requestNumber":"DSP-1051"}' >/dev/null
put_json "/api/requests/$R11" '{"requestNumber":"DSP-1052"}' >/dev/null
put_json "/api/requests/$R12" '{"requestNumber":"DSP-1053"}' >/dev/null

echo "Creating approvals, comments, and visible activity..."
post_json /api/approvals "{\"id\":\"approval_logs\",\"requestId\":\"$R1\",\"requestedFromId\":\"$JEFF_ID\",\"requestedFromName\":\"Jeff Morgan\",\"requestedById\":\"dispatch-operator-agent\",\"requestedByName\":\"Dispatch Agent\",\"requestedByType\":\"agent\",\"status\":\"pending\",\"reason\":\"Production log access requires engineering lead approval.\"}" >/dev/null
post_json /api/approvals "{\"id\":\"approval_figma\",\"requestId\":\"$R2\",\"requestedFromId\":\"$JEFF_ID\",\"requestedFromName\":\"Jeff Morgan\",\"requestedById\":\"$PRIYA_ID\",\"requestedByName\":\"Priya Shah\",\"requestedByType\":\"user\",\"status\":\"pending\",\"reason\":\"Annualized spend is above the team approval threshold.\"}" >/dev/null
post_json /api/approvals "{\"id\":\"approval_credential\",\"requestId\":\"$R7\",\"requestedFromId\":\"$JEFF_ID\",\"requestedFromName\":\"Jeff Morgan\",\"requestedById\":\"$PRIYA_ID\",\"requestedByName\":\"Priya Shah\",\"status\":\"approved\",\"decidedById\":\"$JEFF_ID\",\"decidedByName\":\"Jeff Morgan\",\"reason\":\"Rotation plan reviewed.\",\"decidedAt\":\"2026-09-26T15:30:00Z\"}" >/dev/null

post_json /api/comments "{\"requestId\":\"$R1\",\"authorId\":\"dispatch-operator-agent\",\"authorName\":\"Dispatch Agent\",\"authorType\":\"agent\",\"body\":\"Identified the read-only CloudWatch role and confirmed that it excludes log deletion and configuration changes. Requesting human approval before provisioning.\"}" >/dev/null
post_json /api/comments "{\"requestId\":\"$R3\",\"authorId\":\"$PRIYA_ID\",\"authorName\":\"Priya Shah\",\"authorType\":\"user\",\"body\":\"Replacement is ordered; waiting for tomorrow's delivery window.\"}" >/dev/null
post_json /api/comments "{\"requestId\":\"$R4\",\"authorId\":\"$ALICE_ID\",\"authorName\":\"Alice Chen\",\"authorType\":\"user\",\"body\":\"Failure is isolated to one malformed source record. No data was partially committed.\"}" >/dev/null

post_json /api/requestactivitys "{\"requestId\":\"$R1\",\"actorType\":\"agent\",\"actorId\":\"dispatch-operator-agent\",\"actorName\":\"Dispatch Agent\",\"eventType\":\"investigation.completed\",\"summary\":\"Identified the least-privilege IAM role\"}" >/dev/null
post_json /api/requestactivitys "{\"requestId\":\"$R1\",\"actorType\":\"agent\",\"actorId\":\"dispatch-operator-agent\",\"actorName\":\"Dispatch Agent\",\"eventType\":\"approval.requested\",\"summary\":\"Stopped protected work and requested Jeff Morgan's approval\"}" >/dev/null
post_json /api/requestactivitys "{\"requestId\":\"$R2\",\"actorType\":\"user\",\"actorId\":\"$PRIYA_ID\",\"actorName\":\"Priya Shah\",\"eventType\":\"approval.requested\",\"summary\":\"Requested budget approval\"}" >/dev/null
post_json /api/requestactivitys "{\"requestId\":\"$R7\",\"actorType\":\"user\",\"actorId\":\"$JEFF_ID\",\"actorName\":\"Jeff Morgan\",\"eventType\":\"approval.approved\",\"summary\":\"Approved the credential rotation plan\"}" >/dev/null
post_json /api/requestactivitys "{\"requestId\":\"$R8\",\"actorType\":\"agent\",\"actorId\":\"dispatch-operator-agent\",\"actorName\":\"Dispatch Agent\",\"eventType\":\"request.completed\",\"summary\":\"Granted time-limited repository access and recorded expiry\"}" >/dev/null

echo "Dispatch is ready at $BASE_URL"
echo "Demo password for every account: $DEMO_PASSWORD"
echo "  requester  alice@dispatch.local"
echo "  operator   priya@dispatch.local"
echo "  approver   jeff@dispatch.local"
echo "  admin      admin@dispatch.local"
echo "Agent handoff request: $BASE_URL/requests/$R1"
