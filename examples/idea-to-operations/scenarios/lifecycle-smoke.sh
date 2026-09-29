#!/usr/bin/env bash
# End-to-end lifecycle smoke test against a freshly seeded engine.
#   1. Start the engine with OPS_AGENT_API_KEY set and ZEBRIC_RATE_LIMIT_MAX=5000
#      (polling exceeds the default 100 req/min), then run ./seed.sh.
#   2. BASE_URL=http://127.0.0.1:3000 OPS_AGENT_API_KEY=... scenarios/lifecycle-smoke.sh
# Each check prints PASS/FAIL; the script exits non-zero if any check fails.
# It mutates the seeded database (CSV Export is walked to operating), so reseed after.
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
DEMO_PASSWORD="${DEMO_PASSWORD:-NorthstarDemo1!}"
AGENT_KEY="${OPS_AGENT_API_KEY:?set OPS_AGENT_API_KEY to the agent key the engine started with}"
CSRF="ops-smoke-csrf"
DIR="$(mktemp -d)"; trap 'rm -rf "$DIR"' EXIT
FAILS=0
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="${DB_PATH:-$HERE/../data/app.db}"
NL=$'\n'

login() { curl -sS -X POST "$BASE_URL/api/auth/sign-in/email" -c "$DIR/$1" -b "$DIR/$1" -H "Cookie: csrf-token=$CSRF" -H "x-csrf-token: $CSRF" -H "Origin: $BASE_URL" -H "content-type: application/json" -d "{\"email\":\"$1@northstar.local\",\"password\":\"$DEMO_PASSWORD\"}" >/dev/null; }

# api <user> <METHOD> <path> [json]  -> body on stdout, status in $STATUS
api() {
  local args=(-sS -w "${NL}%{http_code}" -X "$2" "$BASE_URL$3" -b "$DIR/$1" -H "Cookie: csrf-token=$CSRF" -H "x-csrf-token: $CSRF" -H "content-type: application/json" -H "accept: application/json")
  if [ -n "${4:-}" ]; then args+=(-d "$4"); fi
  local out; out="$(curl "${args[@]}")"
  STATUS="${out##*"$NL"}"; printf '%s' "${out%"$NL"*}"
}

# run <user> <workflow> <entity> <recordId> <page> <payload-json>
run() { api "$1" POST "/actions/$2" "{\"entity\":\"$3\",\"recordId\":\"$4\",\"page\":\"$5\",\"payload\":$6}" >"$DIR/last"; }

agent() {
  local args=(-sS -w "${NL}%{http_code}" -X "$1" "$BASE_URL$2" -H "authorization: Bearer $AGENT_KEY" -H "x-agent-run-id: smoke-$$" -H "idempotency-key: smoke-$$-$RANDOM" -H "content-type: application/json" -H "accept: application/json")
  if [ -n "${3:-}" ]; then args+=(-d "$3"); fi
  local out; out="$(curl "${args[@]}")"
  STATUS="${out##*"$NL"}"; printf '%s' "${out%"$NL"*}"
}

# rows <json-file> -> python list; field <name> reads one object from stdin
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('$1') if isinstance(d,dict) else '')"; }
# pick <collection> <python-predicate over x> <field>: first matching row's field
pick() { api dana GET "/api/$1" | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((x.get('$3') for x in d if $2),''))"; }
# ids <collection> <python-predicate>: space-separated ids of matching rows
ids() { api dana GET "/api/$1" | python3 -c "import json,sys;d=json.load(sys.stdin);print(' '.join(x['id'] for x in d if $2))"; }
# wait_for <collection> <id> <field> <value>: poll until a workflow has landed
wait_for() { local i v; for i in $(seq 1 30); do v="$(api dana GET "/api/$1/$2" | field "$3")"; [ "$v" = "$4" ] && return 0; sleep 0.5; done; return 1; }
# check <label> <command...>: pass when the command succeeds
check() { local label="$1"; shift; if "$@"; then STATUS=200; else STATUS=x; fi; : >"$DIR/last"; expect "$label" '^200$'; }

expect() { # expect <label> <want-status-regex>
  if [[ "$STATUS" =~ $2 ]]; then echo "PASS  $1 ($STATUS)"; else echo "FAIL  $1 (got $STATUS, wanted $2): $(head -c 300 "$DIR/last" 2>/dev/null)"; FAILS=$((FAILS+1)); fi
}
settle() { sleep 1; }  # workflows run on a queue; precise waits use wait_for

for u in dana owen olivia sam casey; do login "$u"; done
OWEN_ID="$(sqlite3 "$DB" "select id from user where email='owen@northstar.local'")"
DANA_ID="$(sqlite3 "$DB" "select id from user where email='dana@northstar.local'")"
OLIVIA_ID="$(sqlite3 "$DB" "select id from user where email='olivia@northstar.local'")"
IPAGE="/initiatives/:id"

echo "== Guardrails =="
run sam SubmitProposal Initiative init_csv_export "$IPAGE" '{}'; expect "contributor cannot submit proposal" '^(403|409)$'
run owen SubmitProposal Initiative init_csv_export "$IPAGE" '{}'; expect "proposal blocked while sponsor/outcome missing" '^409$'
run owen ApproveInitiative Initiative init_usage_billing "$IPAGE" '{"decisionId":"dec_billing_approve"}'; expect "owner cannot approve initiative" '^(403|409)$'
run dana ApproveInitiative Initiative init_usage_billing "$IPAGE" '{"decisionId":"dec_billing_approve"}'; sleep 2
check "approval refused while decision is still requested" test "$(api dana GET /api/initiatives/init_usage_billing | field stage)" = "proposal"
agent GET /api/agent/initiatives >"$DIR/last"; expect "agent lists initiatives" '^200$'
agent POST /api/agent/initiatives/init_csv_export/decision-requests '{"kind":"approve_initiative","question":"Agent-prepared: approve CSV Export?","context":"Prepared from evidence.","status":"decided","outcome":"approved"}' >"$DIR/last"; expect "agent prepares a decision request (forged status/outcome supplied)" '^(200|201|202)$'
agent POST /api/agent/ideas '{"title":"Agent idea with forged stage","summary":"probe","stage":"approved","health":"blocked"}' >"$DIR/last"; expect "agent submits an idea (forged stage supplied)" '^(200|201|202)$'
agent POST /api/agent/initiatives/init_portal/draft-milestones '{"title":"Agent draft milestone (forged completed)","status":"completed","completedAt":"2026-01-01T00:00:00Z"}' >"$DIR/last"; expect "agent drafts a milestone (forged status supplied)" '^(200|201|202)$'
sleep 3
check "agent-created decision is requested/pending" test "$(pick decisions "x['question']=='Agent-prepared: approve CSV Export?'" status)/$(pick decisions "x['question']=='Agent-prepared: approve CSV Export?'" outcome)" = "requested/pending"
check "agent-created idea is stage idea" test "$(pick initiatives "x['title']=='Agent idea with forged stage'" stage)" = "idea"
check "agent-drafted milestone is planned" test "$(pick milestones "x['title']=='Agent draft milestone (forged completed)'" status)" = "planned"
agent POST /api/agent/decisions/dec_billing_approve/record '{}' >"$DIR/last"; expect "agent has no record-decision route" '^(404|405)$'
agent POST /api/agent/initiatives/init_usage_billing/approve '{}' >"$DIR/last"; expect "agent has no approve-initiative route" '^(404|405)$'

echo "== Idea -> discovery -> proposal =="
run owen StartDiscovery Initiative init_slack_approvals "$IPAGE" "{\"ownerId\":\"$OWEN_ID\",\"ownerName\":\"Owen Park\",\"problemStatement\":\"Approvers miss waiting decisions.\"}"; expect "start discovery" '^(200|202)$'
check "stage is discovery" wait_for initiatives init_slack_approvals stage discovery
run owen StartDiscovery Initiative init_slack_approvals "$IPAGE" "{\"ownerId\":\"$OWEN_ID\"}"; expect "cannot start discovery twice" '^409$'
api owen PUT /api/initiatives/init_csv_export "{\"sponsorId\":\"$DANA_ID\",\"sponsorName\":\"Dana Whitfield\",\"expectedOutcome\":\"Enterprise admins export any size on demand.\",\"successCriteria\":\"Zero export timeouts for 30 days.\",\"recommendedApproach\":\"Async export with email link.\"}" >"$DIR/last"; expect "owner fills proposal fields" '^(200|204)$'
run owen SubmitProposal Initiative init_csv_export "$IPAGE" '{}'; expect "submit proposal" '^(200|202)$'
check "stage is proposal" wait_for initiatives init_csv_export stage proposal
sleep 2
DEC_ID="$(pick decisions "x['initiativeId']=='init_csv_export' and x['kind']=='approve_initiative' and x['status']=='requested' and x['requestedByName']=='Owen Park'" id)"
check "automation opened the approval decision" test -n "$DEC_ID"

echo "== Decision -> planning =="
run dana RecordDecision Decision "$DEC_ID" /decisions '{"outcome":"approved","decision":"Approved","rationale":"Evidence supports it."}'; expect "decision maker records decision" '^(200|202)$'
check "decision is decided" wait_for decisions "$DEC_ID" status decided
run dana ApproveInitiative Initiative init_csv_export "$IPAGE" "{\"decisionId\":\"$DEC_ID\"}"; expect "approve initiative" '^(200|202)$'
check "automation moved approved -> planning" wait_for initiatives init_csv_export stage planning
run owen StartBuilding Initiative init_csv_export "$IPAGE" '{}'; expect "cannot build without approved plan" '^409$'
run owen CreatePlan Initiative init_csv_export "$IPAGE" '{"targetLaunchDate":"2026-12-01","milestoneTitle":"Async export service","milestoneDate":"2026-11-01"}'; expect "create plan" '^(200|202)$'
sleep 2
run dana ApprovePlan Initiative init_csv_export "$IPAGE" '{}'; expect "approve plan" '^(200|202)$'
sleep 1
run owen StartBuilding Initiative init_csv_export "$IPAGE" '{}'; expect "start building" '^(200|202)$'
check "stage is building" wait_for initiatives init_csv_export stage building

echo "== Building -> launch =="
run owen RequestLaunchReview Initiative init_csv_export "$IPAGE" '{}'; sleep 2
check "launch review refused while a milestone is open" test "$(api dana GET /api/initiatives/init_csv_export | field stage)" = "building"
MS_ID="$(pick milestones "x['initiativeId']=='init_csv_export'" id)"
run owen CompleteMilestone Milestone "$MS_ID" /milestones '{}'; expect "complete milestone" '^(200|202)$'
check "milestone completed" wait_for milestones "$MS_ID" status completed
run owen RequestLaunchReview Initiative init_csv_export "$IPAGE" '{}'; expect "request launch review" '^(200|202)$'
check "stage is launch" wait_for initiatives init_csv_export stage launch
N="$(ids readinesschecks "x['initiativeId']=='init_csv_export'" | wc -w | tr -d ' ')"
check "five readiness checks generated (got $N)" test "$N" = "5"
run dana ApproveLaunch Initiative init_csv_export "$IPAGE" "{\"decisionId\":\"none\",\"operationalOwnerId\":\"$OLIVIA_ID\",\"operationalOwnerName\":\"Olivia Reyes\",\"runbookUrl\":\"https://wiki.northstar.example/runbooks/csv\"}"; sleep 2
check "launch approval refused with unresolved checks" test -z "$(api dana GET /api/initiatives/init_csv_export | field launchApprovedAt)" -o "$(api dana GET /api/initiatives/init_csv_export | field launchApprovedAt)" = "None"
for id in $(ids readinesschecks "x['initiativeId']=='init_csv_export'"); do
  run dana CompleteReadinessCheck ReadinessCheck "$id" /launches '{"status":"ready","notes":"ok"}'; sleep 0.5
done
run owen RequestDecision Initiative init_csv_export "$IPAGE" '{"kind":"approve_launch","question":"Approve CSV Export launch?","context":"All checks ready."}'; expect "owner requests launch decision" '^(200|202)$'
sleep 2
LDEC="$(pick decisions "x['initiativeId']=='init_csv_export' and x['kind']=='approve_launch'" id)"
run dana RecordDecision Decision "$LDEC" /decisions '{"outcome":"approved","decision":"Launch approved","rationale":"Ready."}'
check "launch decision is decided" wait_for decisions "$LDEC" status decided
api owen POST /api/dependencys '{"id":"dep_smoke_block","sourceType":"initiative","sourceId":"init_csv_export","sourceLabel":"CSV Export","targetType":"initiative","targetId":"init_data_export","targetLabel":"Data Export v1","type":"blocks_launch","status":"open","description":"Smoke-test blocker"}' >"$DIR/last"; expect "owner records a blocking dependency" '^(200|201)$'
run dana ApproveLaunch Initiative init_csv_export "$IPAGE" "{\"decisionId\":\"$LDEC\",\"operationalOwnerId\":\"$OLIVIA_ID\",\"operationalOwnerName\":\"Olivia Reyes\",\"runbookUrl\":\"https://wiki.northstar.example/runbooks/csv\"}"; sleep 2
check "launch approval refused while a blocks_launch dependency is open" test -z "$(api dana GET /api/initiatives/init_csv_export | field launchApprovedAt | grep -v None)"
api owen PUT /api/dependencys/dep_smoke_block '{"status":"satisfied"}' >"$DIR/last"; expect "owner satisfies the dependency" '^(200|204)$'
run dana ApproveLaunch Initiative init_csv_export "$IPAGE" "{\"decisionId\":\"$LDEC\",\"operationalOwnerId\":\"$OLIVIA_ID\",\"operationalOwnerName\":\"Olivia Reyes\",\"runbookUrl\":\"https://wiki.northstar.example/runbooks/csv\"}"; expect "approve launch" '^(200|202)$'
sleep 2
run owen TransitionToOperations Initiative init_csv_export "$IPAGE" '{}'; expect "transition to operations" '^(200|202)$'
check "stage is operating" wait_for initiatives init_csv_export stage operating
N="$(ids operationalcapabilitys "x['initiativeId']=='init_csv_export'" | wc -w | tr -d ' ')"
check "operational capability created (got $N)" test "$N" = "1"

echo "== Feedback loop =="
agent POST /api/agent/observations/obs_scheduled_exports/create-initiative '{"title":"Scheduled exports"}' >"$DIR/last"; expect "agent converts observation to idea" '^(200|202)$'
check "observation marked converted" wait_for observations obs_scheduled_exports status converted
N="$(ids initiatives "x.get('sourceObservationId')=='obs_scheduled_exports' and x['stage']=='idea'" | wc -w | tr -d ' ')"
check "new idea carries provenance (got $N)" test "$N" = "1"

echo "== Pages =="
for path in / /attention /decisions /milestones /launches /operations /observations /initiatives/init_portal /ideas/new; do
  code="$(curl -s -o "$DIR/page" -w '%{http_code}' -b "$DIR/dana" "$BASE_URL$path")"; STATUS="$code"; expect "GET $path" '^200$'
done

echo; [ "$FAILS" -eq 0 ] && echo "All checks passed." || echo "$FAILS check(s) failed."
exit "$FAILS"
