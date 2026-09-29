#!/usr/bin/env bash
# Seeds Northstar Labs: seven initiatives across the lifecycle, with the
# interconnected evidence, decisions, plans, readiness checks, operating
# capabilities, metrics and observations that tell their stories.
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
DEMO_PASSWORD="${DEMO_PASSWORD:-NorthstarDemo1!}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${DB_PATH:-$SCRIPT_DIR/data/app.db}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT
CSRF_TOKEN="${CSRF_TOKEN:-ops-seed-csrf}"

post_json() {
  curl -fsS --retry 8 --retry-delay 1 --retry-all-errors -X POST "$BASE_URL$1" -b "$COOKIE_JAR" \
    -H "Cookie: csrf-token=$CSRF_TOKEN" -H "x-csrf-token: $CSRF_TOKEN" \
    -H "content-type: application/json" -H "accept: application/json" -d "$2"
}

post_auth() {
  curl -sS --retry 8 --retry-delay 1 --retry-all-errors -X POST "$BASE_URL$1" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "Cookie: csrf-token=$CSRF_TOKEN" -H "x-csrf-token: $CSRF_TOKEN" \
    -H "Origin: $BASE_URL" -H "content-type: application/json" -H "accept: application/json" -d "$2"
}

# add <collection> <<JSON ... JSON  -- reads one JSON document from stdin.
add() { post_json "/api/$1" "$(cat)" >/dev/null; }

echo "Provisioning Northstar demo identities..."
for entry in "casey@northstar.local:Casey Admin" "dana@northstar.local:Dana Whitfield" "owen@northstar.local:Owen Park" "olivia@northstar.local:Olivia Reyes" "sam@northstar.local:Sam Ito"; do
  post_auth /api/auth/sign-up/email "{\"email\":\"${entry%%:*}\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"${entry#*:}\"}" >/dev/null || true
done

sqlite3 "$DB_PATH" <<SQL
UPDATE user SET role = 'admin' WHERE email = 'casey@northstar.local';
UPDATE user SET role = 'decision_maker' WHERE email = 'dana@northstar.local';
UPDATE user SET role = 'initiative_owner' WHERE email = 'owen@northstar.local';
UPDATE user SET role = 'operational_owner' WHERE email = 'olivia@northstar.local';
UPDATE user SET role = 'user' WHERE email = 'sam@northstar.local';
SQL

uid() { sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='$1' LIMIT 1;"; }
DANA="$(uid dana@northstar.local)"; OWEN="$(uid owen@northstar.local)"
OLIVIA="$(uid olivia@northstar.local)"; SAM="$(uid sam@northstar.local)"

post_auth /api/auth/sign-in/email "{\"email\":\"casey@northstar.local\",\"password\":\"$DEMO_PASSWORD\"}" >/dev/null

if curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/initiatives" | grep -q 'init_csv_export'; then
  echo "Northstar demo data already exists; leaving it unchanged."
  exit 0
fi

echo "Creating initiatives..."
add initiatives <<JSON
{"id":"init_csv_export","title":"CSV Export","summary":"Enterprise customers need bulk CSV exports of their records.","stage":"discovery","health":"healthy","priority":"high","ownerId":"$OWEN","ownerName":"Owen Park","createdById":"$SAM","createdByName":"Sam Ito","problemStatement":"Enterprise admins export records one page at a time through the UI, and support files tickets asking us to run exports manually.","sourceCapabilityId":"cap_data_export","createdAt":"2026-08-24T15:00:00Z"}
JSON
add initiatives <<JSON
{"id":"init_usage_billing","title":"Usage-Based Billing","summary":"Consider moving the Analytics product from seats to metered usage.","stage":"proposal","health":"attention","healthReason":"Executive decision overdue","priority":"high","ownerId":"$OWEN","ownerName":"Owen Park","sponsorId":"$DANA","sponsorName":"Dana Whitfield","createdById":"$DANA","createdByName":"Dana Whitfield","problemStatement":"Seat pricing penalizes broad adoption and under-charges heavy API users.","expectedOutcome":"Expansion revenue from heavy users without hurting light-user retention.","successCriteria":"Net revenue retention up 4 points within two quarters; no increase in churn among accounts under 20 seats.","recommendedApproach":"Hybrid: platform fee plus metered API and export overage.","createdAt":"2026-07-06T15:00:00Z"}
JSON
add initiatives <<JSON
{"id":"init_portal","title":"New Customer Portal","summary":"Replace the legacy portal with a self-service portal for account, billing and support.","stage":"building","health":"blocked","healthReason":"Milestone blocked: Billing integration","priority":"high","ownerId":"$OWEN","ownerName":"Owen Park","sponsorId":"$DANA","sponsorName":"Dana Whitfield","createdById":"$OWEN","createdByName":"Owen Park","problemStatement":"Customers cannot self-serve billing or user management; support handles 30% of these requests.","expectedOutcome":"Cut portal-related support volume by a third.","successCriteria":"Support contacts about account admin fall below 20% of volume.","recommendedApproach":"Build on API v2 with an incremental cutover.","targetLaunchDate":"2026-12-15T00:00:00Z","planApprovedAt":"2026-08-20T15:00:00Z","createdAt":"2026-05-11T15:00:00Z"}
JSON
add initiatives <<JSON
{"id":"init_api_v2","title":"API v2","summary":"Versioned public API with pagination, idempotency keys and webhooks.","stage":"launch","health":"attention","healthReason":"3 launch readiness checks incomplete","priority":"high","ownerId":"$OWEN","ownerName":"Owen Park","sponsorId":"$DANA","sponsorName":"Dana Whitfield","createdById":"$OWEN","createdByName":"Owen Park","problemStatement":"v1 cannot evolve without breaking integrators.","expectedOutcome":"Integrators adopt v2; v1 traffic declines.","successCriteria":"60% of API traffic on v2 within six months.","recommendedApproach":"Ship v2 alongside v1 with a deprecation window.","targetLaunchDate":"2026-10-15T00:00:00Z","planApprovedAt":"2026-03-30T15:00:00Z","createdAt":"2026-02-16T15:00:00Z"}
JSON
add initiatives <<JSON
{"id":"init_sso","title":"Enterprise SSO","summary":"SAML and OIDC single sign-on with self-service setup.","stage":"operating","health":"healthy","priority":"high","ownerId":"$OWEN","ownerName":"Owen Park","sponsorId":"$DANA","sponsorName":"Dana Whitfield","createdById":"$SAM","createdByName":"Sam Ito","problemStatement":"Enterprise prospects require SSO to pass security review.","expectedOutcome":"Unblock enterprise deals stalled on security review.","successCriteria":"SSO enabled for 40% of enterprise accounts within a quarter.","recommendedApproach":"SAML first, OIDC second, self-service setup wizard.","targetLaunchDate":"2026-04-30T00:00:00Z","planApprovedAt":"2026-01-20T15:00:00Z","launchApprovedAt":"2026-04-22T15:00:00Z","operationalOwnerId":"$OLIVIA","operationalOwnerName":"Olivia Reyes","runbookUrl":"https://wiki.northstar.example/runbooks/sso","launchedAt":"2026-05-01T15:00:00Z","createdAt":"2025-11-17T15:00:00Z"}
JSON
add initiatives <<JSON
{"id":"init_data_export","title":"Data Export v1","summary":"Self-serve export of account data as JSON and basic CSV.","stage":"operating","health":"healthy","priority":"medium","ownerId":"$OWEN","ownerName":"Owen Park","sponsorId":"$DANA","sponsorName":"Dana Whitfield","createdById":"$OWEN","createdByName":"Owen Park","problemStatement":"Customers need to take their data out for audits and analysis.","expectedOutcome":"Self-serve export replaces manual support exports.","successCriteria":"99% export success; manual export tickets under 5 a month.","recommendedApproach":"Synchronous export with a row cap.","targetLaunchDate":"2026-02-27T00:00:00Z","planApprovedAt":"2025-12-15T15:00:00Z","launchApprovedAt":"2026-02-20T15:00:00Z","operationalOwnerId":"$OLIVIA","operationalOwnerName":"Olivia Reyes","runbookUrl":"https://wiki.northstar.example/runbooks/data-export","launchedAt":"2026-03-03T15:00:00Z","createdAt":"2025-10-06T15:00:00Z"}
JSON
add initiatives <<JSON
{"id":"init_slack_approvals","title":"Slack notifications for approvals","summary":"Notify approvers in Slack when a decision is waiting.","stage":"idea","priority":"low","createdById":"$SAM","createdByName":"Sam Ito","createdAt":"2026-09-22T15:00:00Z"}
JSON
add initiatives <<JSON
{"id":"init_audit_export","title":"Audit log export","summary":"Security teams want to stream our audit log into their SIEM.","stage":"idea","priority":"medium","createdById":"$SAM","createdByName":"Sam Ito","createdAt":"2026-09-25T15:00:00Z"}
JSON

echo "Creating operational capabilities, metrics and observations..."
add operationalcapabilitys <<JSON
{"id":"cap_sso","initiativeId":"init_sso","name":"Enterprise SSO","description":"SAML and OIDC single sign-on with self-service setup.","ownerId":"$OLIVIA","ownerName":"Olivia Reyes","status":"healthy","runbookUrl":"https://wiki.northstar.example/runbooks/sso","launchedAt":"2026-05-01T15:00:00Z","reviewCadence":"quarterly","lastReviewedAt":"2026-05-15T15:00:00Z","nextReviewDue":"2026-08-15T15:00:00Z"}
JSON
add operationalcapabilitys <<JSON
{"id":"cap_data_export","initiativeId":"init_data_export","name":"Data Export v1","description":"Self-serve account data export.","ownerId":"$OLIVIA","ownerName":"Olivia Reyes","status":"attention","runbookUrl":"https://wiki.northstar.example/runbooks/data-export","launchedAt":"2026-03-03T15:00:00Z","reviewCadence":"monthly","lastReviewedAt":"2026-09-05T15:00:00Z","nextReviewDue":"2026-10-05T15:00:00Z"}
JSON
add metrics <<JSON
{"id":"met_sso_adoption","capabilityId":"cap_sso","name":"SSO enabled enterprise accounts","target":">= 40%","currentValue":"46%","status":"on_target"}
JSON
add metrics <<JSON
{"id":"met_sso_tickets","capabilityId":"cap_sso","name":"SSO setup support tickets / month","target":"< 10","currentValue":"11","status":"watch"}
JSON
add metrics <<JSON
{"id":"met_export_success","capabilityId":"cap_data_export","name":"Export success rate","target":"> 99%","currentValue":"97.4%","status":"off_target"}
JSON
add metrics <<JSON
{"id":"met_export_p95","capabilityId":"cap_data_export","name":"Export p95 duration","target":"< 30s","currentValue":"41s","status":"off_target"}
JSON
add observations <<JSON
{"id":"obs_export_timeouts","capabilityId":"cap_data_export","title":"CSV exports above 500k rows frequently time out","description":"Support logged 14 timeouts in September, all from enterprise accounts with more than 500k rows.","severity":"high","status":"open","createdById":"$OLIVIA","createdByName":"Olivia Reyes"}
JSON
add observations <<JSON
{"id":"obs_scheduled_exports","capabilityId":"cap_data_export","title":"Customers frequently ask for scheduled exports","description":"Nine accounts asked for a nightly export instead of running one by hand.","severity":"medium","status":"open","createdById":"$OLIVIA","createdByName":"Olivia Reyes"}
JSON
add observations <<JSON
{"id":"obs_sso_support_drop","capabilityId":"cap_sso","title":"Support volume dropped after SSO self-service setup shipped","description":"SSO setup tickets fell from 38 to 11 a month.","severity":"low","status":"dismissed","createdById":"$OLIVIA","createdByName":"Olivia Reyes"}
JSON

echo "Creating discovery material..."
add evidences <<JSON
{"id":"ev_csv_1","initiativeId":"init_csv_export","type":"customer_request","title":"Acme Corp requested bulk CSV in QBR","summary":"Acme's data team exports 800k rows monthly and asked for a single download.","submittedById":"$SAM","submittedByName":"Sam Ito"}
JSON
add evidences <<JSON
{"id":"ev_csv_2","initiativeId":"init_csv_export","type":"support_ticket","title":"14 timeout tickets in September","summary":"Exports above 500k rows time out in the UI.","sourceUrl":"https://support.northstar.example/tickets?q=export-timeout","submittedById":"$OLIVIA","submittedByName":"Olivia Reyes"}
JSON
add evidences <<JSON
{"id":"ev_csv_3","initiativeId":"init_csv_export","type":"analytics","title":"Export usage is 2.4x YoY","summary":"Export requests grew 2.4x year over year among enterprise accounts.","submittedById":"$OWEN","submittedByName":"Owen Park"}
JSON
add evidences <<JSON
{"id":"ev_csv_4","initiativeId":"init_csv_export","type":"agent_research","title":"Competitor export limits","summary":"Three of four competitors offer async exports with email delivery.","submittedById":"ops-agent","submittedByName":"Operations Agent"}
JSON
add evidences <<JSON
{"id":"ev_billing_1","initiativeId":"init_usage_billing","type":"analytics","title":"Top 5% of accounts drive 61% of API calls","summary":"Heavy users are billed the same as light users.","submittedById":"$OWEN","submittedByName":"Owen Park"}
JSON
add evidences <<JSON
{"id":"ev_billing_2","initiativeId":"init_usage_billing","type":"market_research","title":"Peer pricing survey","summary":"Seven of ten peers moved to hybrid pricing in the last two years.","submittedById":"$DANA","submittedByName":"Dana Whitfield"}
JSON
add evidences <<JSON
{"id":"ev_billing_3","initiativeId":"init_usage_billing","type":"experiment","title":"Metered pricing pilot with 12 accounts","summary":"Two of twelve pilot accounts reduced usage after seeing meters.","submittedById":"$OWEN","submittedByName":"Owen Park"}
JSON
add evidences <<JSON
{"id":"ev_portal_1","initiativeId":"init_portal","type":"support_ticket","title":"Account admin requests are 30% of volume","summary":"Password resets, invoice copies and seat changes dominate support.","submittedById":"$OWEN","submittedByName":"Owen Park"}
JSON
add evidences <<JSON
{"id":"ev_sso_1","initiativeId":"init_sso","type":"customer_request","title":"Security review blocked on SSO at three enterprise prospects","summary":"Three deals worth over 200k dollars each were stalled.","submittedById":"$SAM","submittedByName":"Sam Ito"}
JSON
add evidences <<JSON
{"id":"ev_sso_2","initiativeId":"init_sso","type":"internal_observation","title":"Support volume dropped after self-service shipped","summary":"Operating evidence that the outcome was achieved.","submittedById":"$OLIVIA","submittedByName":"Olivia Reyes"}
JSON
add evidences <<JSON
{"id":"ev_api_1","initiativeId":"init_api_v2","type":"customer_request","title":"Integrator asks for idempotency keys","summary":"Partners double-charge on retry with v1.","submittedById":"$OWEN","submittedByName":"Owen Park"}
JSON

add openquestions <<JSON
{"id":"q_csv_1","initiativeId":"init_csv_export","question":"Should CSV exports include archived records?","status":"open","blocksProgression":true}
JSON
add openquestions <<JSON
{"id":"q_csv_2","initiativeId":"init_csv_export","question":"Is delivery by email link acceptable to enterprise security teams?","status":"open","blocksProgression":true}
JSON
add openquestions <<JSON
{"id":"q_csv_3","initiativeId":"init_csv_export","question":"Which columns are exportable for restricted fields?","status":"resolved","answer":"Restricted fields are excluded unless the requester holds the data-steward role.","blocksProgression":false,"resolvedAt":"2026-09-10T15:00:00Z"}
JSON
add openquestions <<JSON
{"id":"q_billing_1","initiativeId":"init_usage_billing","question":"Will finance accept revenue recognition for metered overage?","status":"open","blocksProgression":true}
JSON
add assumptions <<JSON
{"id":"a_csv_1","initiativeId":"init_csv_export","statement":"Enterprise customers will export data at most once per day.","status":"open","blocksProgression":false}
JSON
add assumptions <<JSON
{"id":"a_csv_2","initiativeId":"init_csv_export","statement":"Async export with email delivery removes the timeout problem.","status":"validated","resolution":"Prototype completed a 1.2M row export in 4 minutes.","resolvedAt":"2026-09-18T15:00:00Z"}
JSON
add assumptions <<JSON
{"id":"a_billing_1","initiativeId":"init_usage_billing","statement":"Customers under 20 seats will not churn over metering.","status":"open","blocksProgression":true}
JSON

add alternatives <<JSON
{"id":"alt_csv_1","initiativeId":"init_csv_export","title":"Async export with email link","description":"Queue the export and email a signed download link.","advantages":"Handles any size; simple UX.","disadvantages":"Email delivery may be blocked by policy.","estimatedEffort":"4 weeks","status":"recommended"}
JSON
add alternatives <<JSON
{"id":"alt_csv_2","initiativeId":"init_csv_export","title":"Raise the synchronous row cap","description":"Increase the cap and time limit.","advantages":"Trivial.","disadvantages":"Does not scale; keeps timeouts.","estimatedEffort":"1 week","status":"considering"}
JSON
add alternatives <<JSON
{"id":"alt_csv_3","initiativeId":"init_csv_export","title":"Scheduled exports to customer storage","description":"Nightly export pushed to the customer's S3 bucket.","advantages":"Meets the scheduled-export requests.","disadvantages":"Needs storage credential management.","estimatedEffort":"8 weeks","status":"considering"}
JSON
add alternatives <<JSON
{"id":"alt_billing_1","initiativeId":"init_usage_billing","title":"Pure metered pricing","description":"Charge only for usage.","advantages":"Aligns cost and value.","disadvantages":"Unpredictable bills; churn risk for small accounts.","estimatedEffort":"5 months","status":"considering"}
JSON
add alternatives <<JSON
{"id":"alt_billing_2","initiativeId":"init_usage_billing","title":"Hybrid platform fee plus overage","description":"Keep a platform fee and meter API and export overage.","advantages":"Predictable base; captures heavy usage.","disadvantages":"Two things to explain.","estimatedEffort":"4 months","status":"recommended"}
JSON
add alternatives <<JSON
{"id":"alt_billing_3","initiativeId":"init_usage_billing","title":"Keep seat pricing, add usage tiers","description":"Introduce tier ceilings on API volume.","advantages":"Smallest change.","disadvantages":"Cliffs and workarounds.","estimatedEffort":"2 months","status":"considering"}
JSON

echo "Creating decisions..."
add decisions <<JSON
{"id":"dec_billing_approve","initiativeId":"init_usage_billing","kind":"approve_initiative","question":"Approve Usage-Based Billing?","context":"Hybrid pricing recommended; pilot shows two of twelve accounts reduced usage.","status":"requested","outcome":"pending","requestedById":"$OWEN","requestedByName":"Owen Park","dueDate":"2026-09-15T00:00:00Z","requestedAt":"2026-09-01T15:00:00Z"}
JSON
add decisions <<JSON
{"id":"dec_billing_approach","initiativeId":"init_usage_billing","kind":"select_approach","question":"Which pricing approach do we take?","context":"Three alternatives under consideration; hybrid recommended.","status":"requested","outcome":"pending","requestedById":"$OWEN","requestedByName":"Owen Park","dueDate":"2026-10-10T00:00:00Z","requestedAt":"2026-09-12T15:00:00Z"}
JSON
add decisions <<JSON
{"id":"dec_portal_approve","initiativeId":"init_portal","kind":"approve_initiative","question":"Approve New Customer Portal?","context":"Build on API v2 with incremental cutover.","status":"decided","outcome":"approved","decision":"Approved with a Q4 launch target.","rationale":"Support volume justifies the investment.","decidedById":"$DANA","decidedByName":"Dana Whitfield","decidedAt":"2026-08-12T15:00:00Z","requestedById":"$OWEN","requestedByName":"Owen Park","requestedAt":"2026-08-01T15:00:00Z"}
JSON
add decisions <<JSON
{"id":"dec_api_approve","initiativeId":"init_api_v2","kind":"approve_initiative","question":"Approve API v2?","status":"decided","outcome":"approved","decision":"Approved.","rationale":"v1 cannot evolve safely.","decidedById":"$DANA","decidedByName":"Dana Whitfield","decidedAt":"2026-03-10T15:00:00Z","requestedById":"$OWEN","requestedByName":"Owen Park","requestedAt":"2026-03-01T15:00:00Z"}
JSON
add decisions <<JSON
{"id":"dec_api_launch","initiativeId":"init_api_v2","kind":"approve_launch","question":"Approve API v2 launch?","context":"Three readiness checks remain open.","status":"requested","outcome":"pending","requestedById":"$OWEN","requestedByName":"Owen Park","dueDate":"2026-10-08T00:00:00Z","requestedAt":"2026-09-24T15:00:00Z"}
JSON
add decisions <<JSON
{"id":"dec_sso_approve","initiativeId":"init_sso","kind":"approve_initiative","question":"Approve Enterprise SSO?","status":"decided","outcome":"approved","decision":"Approved.","rationale":"Three deals are blocked on it.","decidedById":"$DANA","decidedByName":"Dana Whitfield","decidedAt":"2026-01-12T15:00:00Z","requestedById":"$OWEN","requestedByName":"Owen Park","requestedAt":"2026-01-05T15:00:00Z"}
JSON
add decisions <<JSON
{"id":"dec_sso_launch","initiativeId":"init_sso","kind":"approve_launch","question":"Approve Enterprise SSO launch?","status":"decided","outcome":"approved","decision":"Launch approved.","rationale":"All readiness checks are ready.","decidedById":"$DANA","decidedByName":"Dana Whitfield","decidedAt":"2026-04-22T15:00:00Z","requestedById":"$OWEN","requestedByName":"Owen Park","requestedAt":"2026-04-15T15:00:00Z"}
JSON

echo "Creating plans, tasks, dependencies and risks..."
add milestones <<JSON
{"id":"ms_portal_1","initiativeId":"init_portal","title":"Authentication and account shell","ownerId":"$OWEN","ownerName":"Owen Park","status":"completed","targetDate":"2026-09-01T00:00:00Z","completedAt":"2026-08-29T15:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_portal_2","initiativeId":"init_portal","title":"User management","ownerId":"$OWEN","ownerName":"Owen Park","status":"active","targetDate":"2026-10-20T00:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_portal_3","initiativeId":"init_portal","title":"Billing integration","ownerId":"$OWEN","ownerName":"Owen Park","status":"blocked","targetDate":"2026-09-20T00:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_portal_4","initiativeId":"init_portal","title":"Support workflows and cutover","ownerId":"$OWEN","ownerName":"Owen Park","status":"planned","targetDate":"2026-12-01T00:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_api_1","initiativeId":"init_api_v2","title":"Pagination and idempotency","ownerId":"$OWEN","ownerName":"Owen Park","status":"completed","targetDate":"2026-06-30T00:00:00Z","completedAt":"2026-06-27T15:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_api_2","initiativeId":"init_api_v2","title":"Webhooks","ownerId":"$OWEN","ownerName":"Owen Park","status":"completed","targetDate":"2026-08-15T00:00:00Z","completedAt":"2026-08-14T15:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_api_3","initiativeId":"init_api_v2","title":"Beta partner rollout","ownerId":"$OWEN","ownerName":"Owen Park","status":"completed","targetDate":"2026-09-15T00:00:00Z","completedAt":"2026-09-14T15:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_sso_1","initiativeId":"init_sso","title":"SAML support","ownerId":"$OWEN","ownerName":"Owen Park","status":"completed","targetDate":"2026-03-01T00:00:00Z","completedAt":"2026-02-27T15:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_sso_2","initiativeId":"init_sso","title":"Self-service setup wizard","ownerId":"$OWEN","ownerName":"Owen Park","status":"completed","targetDate":"2026-04-15T00:00:00Z","completedAt":"2026-04-12T15:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_export_1","initiativeId":"init_data_export","title":"Synchronous export","ownerId":"$OWEN","ownerName":"Owen Park","status":"completed","targetDate":"2026-02-15T00:00:00Z","completedAt":"2026-02-12T15:00:00Z"}
JSON
add milestones <<JSON
{"id":"ms_billing_draft","initiativeId":"init_usage_billing","title":"Metering pipeline (draft, prepared by agent)","status":"planned","isDraft":true,"targetDate":"2026-12-01T00:00:00Z"}
JSON

i=0
for spec in \
  "init_portal|ms_portal_1|Design system audit|done|$SAM|Sam Ito" \
  "init_portal|ms_portal_2|Role and permission model|in_progress|$OWEN|Owen Park" \
  "init_portal|ms_portal_2|Invite flow|todo|$SAM|Sam Ito" \
  "init_portal|ms_portal_3|Payment provider contract|blocked|$OWEN|Owen Park" \
  "init_portal|ms_portal_3|Invoice history API|todo|$OWEN|Owen Park" \
  "init_portal|ms_portal_4|Support handoff runbook|todo|$OLIVIA|Olivia Reyes" \
  "init_api_v2|ms_api_3|Partner feedback triage|done|$OWEN|Owen Park" \
  "init_api_v2||Write v1 deprecation notice|in_progress|$OWEN|Owen Park" \
  "init_csv_export||Prototype async export|done|$OWEN|Owen Park" \
  "init_csv_export||Interview three enterprise admins|in_progress|$SAM|Sam Ito" \
  "init_usage_billing||Model revenue under hybrid pricing|done|$OWEN|Owen Park" \
  "init_usage_billing||Draft customer communication|todo|$SAM|Sam Ito" \
  "init_sso||Publish setup guide|done|$OLIVIA|Olivia Reyes" \
  "init_data_export||Quarterly capacity review|todo|$OLIVIA|Olivia Reyes" \
  "init_data_export||Investigate export timeouts|in_progress|$OLIVIA|Olivia Reyes" \
  "init_sso||SCIM provisioning spike|todo|$OWEN|Owen Park" \
  "init_portal||Accessibility review|todo|$SAM|Sam Ito" \
  "init_api_v2||Rate limit tuning|todo|$OWEN|Owen Park"; do
  i=$((i+1)); IFS='|' read -r init ms title status assignee name <<<"$spec"
  msjson="null"; [ -n "$ms" ] && msjson="\"$ms\""
  add tasks <<JSON
{"id":"task_$i","initiativeId":"$init","milestoneId":$msjson,"title":"$title","status":"$status","assignedToId":"$assignee","assignedToName":"$name","dueDate":"2026-10-15T00:00:00Z"}
JSON
done

add dependencys <<JSON
{"id":"dep_portal_api","sourceType":"initiative","sourceId":"init_portal","sourceLabel":"New Customer Portal","targetType":"initiative","targetId":"init_api_v2","targetLabel":"API v2","type":"blocks_launch","status":"open","description":"Portal launch requires API v2 production availability."}
JSON
add dependencys <<JSON
{"id":"dep_billing_portal","sourceType":"milestone","sourceId":"ms_portal_3","sourceLabel":"Billing integration","targetType":"milestone","targetId":"ms_portal_2","targetLabel":"User management","type":"blocks_start","status":"satisfied","description":"Billing needs the permission model first."}
JSON
add dependencys <<JSON
{"id":"dep_csv_api","sourceType":"initiative","sourceId":"init_csv_export","sourceLabel":"CSV Export","targetType":"initiative","targetId":"init_api_v2","targetLabel":"API v2","type":"informs","status":"open","description":"Async export should reuse v2 pagination and webhooks."}
JSON
add dependencys <<JSON
{"id":"dep_api_docs","sourceType":"initiative","sourceId":"init_api_v2","sourceLabel":"API v2","targetType":"initiative","targetId":"init_sso","targetLabel":"Enterprise SSO","type":"blocks_launch","status":"satisfied","description":"v2 tokens rely on SSO session claims."}
JSON

add risks <<JSON
{"id":"risk_portal_1","initiativeId":"init_portal","title":"Payment provider contract delayed","description":"Legal review of the provider contract has slipped twice.","likelihood":"high","impact":"high","mitigation":"Escalate to legal; evaluate a second provider.","ownerId":"$OWEN","ownerName":"Owen Park","status":"open"}
JSON
add risks <<JSON
{"id":"risk_portal_2","initiativeId":"init_portal","title":"Cutover confuses legacy portal users","likelihood":"medium","impact":"medium","mitigation":"Phased cutover with in-app banner.","ownerId":"$OWEN","ownerName":"Owen Park","status":"open"}
JSON
add risks <<JSON
{"id":"risk_api_1","initiativeId":"init_api_v2","title":"Partners slow to migrate off v1","likelihood":"medium","impact":"high","mitigation":"Twelve-month deprecation window and migration tooling.","ownerId":"$OWEN","ownerName":"Owen Park","status":"open"}
JSON
add risks <<JSON
{"id":"risk_api_2","initiativeId":"init_api_v2","title":"Rate limits too strict for large partners","likelihood":"low","impact":"medium","mitigation":"Per-partner overrides.","ownerId":"$OWEN","ownerName":"Owen Park","status":"mitigated"}
JSON
add risks <<JSON
{"id":"risk_billing_1","initiativeId":"init_usage_billing","title":"Small accounts churn over metering","likelihood":"medium","impact":"high","mitigation":"Platform fee includes a generous allowance.","ownerId":"$OWEN","ownerName":"Owen Park","status":"open"}
JSON
add risks <<JSON
{"id":"risk_export_1","initiativeId":"init_data_export","title":"Row cap frustrates enterprise customers","likelihood":"high","impact":"medium","mitigation":"CSV Export initiative under discovery.","ownerId":"$OLIVIA","ownerName":"Olivia Reyes","status":"accepted"}
JSON

# Creating a high/high risk fires the HighRiskHealth automation, which sets the
# portal to at_risk (last event wins; see ZEBRIC_GAPS). Re-assert the intended
# blocked state, which outranks at_risk, the way a human owner would.
sleep 3  # let the queued automation land first
curl -fsS -X PUT "$BASE_URL/api/initiatives/init_portal" -b "$COOKIE_JAR" -H "Cookie: csrf-token=$CSRF_TOKEN" -H "x-csrf-token: $CSRF_TOKEN" -H "content-type: application/json" -d '{"health":"blocked","healthReason":"Milestone blocked: Billing integration; contract risk open"}' >/dev/null

echo "Creating readiness checks..."
i=0
for spec in \
  "init_api_v2|engineering|Production deploy and rollback verified|ready|Rollback rehearsed 09-20." \
  "init_api_v2|security|Security review complete|ready|Pen test findings closed." \
  "init_api_v2|support|Support team trained|pending|Training scheduled." \
  "init_api_v2|documentation|Customer documentation published|blocked|Reference docs missing webhook signatures." \
  "init_api_v2|operations|Runbook and on-call owner assigned|pending|Owner not yet named." \
  "init_sso|engineering|Production deploy and rollback verified|ready|" \
  "init_sso|security|Security review complete|ready|" \
  "init_sso|support|Support team trained|ready|" \
  "init_sso|documentation|Customer documentation published|ready|" \
  "init_sso|operations|Runbook and on-call owner assigned|ready|" \
  "init_data_export|operations|Runbook and on-call owner assigned|ready|" \
  "init_data_export|analytics|Success metrics instrumented|waived|Waived by decision maker; add in v1.1."; do
  i=$((i+1)); IFS='|' read -r init cat title status notes <<<"$spec"
  completed="null"; { [ "$status" = "ready" ] || [ "$status" = "waived" ]; } && completed='"2026-09-01T15:00:00Z"'
  add readinesschecks <<JSON
{"id":"rc_$i","initiativeId":"$init","category":"$cat","title":"$title","status":"$status","ownerId":"$OWEN","ownerName":"Owen Park","notes":"$notes","completedAt":$completed}
JSON
done

echo "Creating activity trail..."
i=0
for spec in \
  "init_csv_export|idea_submitted|Idea submitted by Sam Ito|Sam Ito|2026-08-24T15:00:00Z" \
  "init_csv_export|stage_change|Discovery started; owner Owen Park|Owen Park|2026-08-26T15:00:00Z" \
  "init_csv_export|evidence_added|Evidence added: 14 timeout tickets in September|Olivia Reyes|2026-09-08T15:00:00Z" \
  "init_csv_export|evidence_added|Evidence added: Competitor export limits|Operations Agent|2026-09-16T15:00:00Z" \
  "init_usage_billing|idea_submitted|Idea submitted by Dana Whitfield|Dana Whitfield|2026-07-06T15:00:00Z" \
  "init_usage_billing|proposal_submitted|Proposal submitted: hybrid platform fee plus overage|Owen Park|2026-09-01T15:00:00Z" \
  "init_usage_billing|decision_requested|Approval decision requested (automation)|System|2026-09-01T15:00:00Z" \
  "init_portal|decision_recorded|Dana Whitfield decided (approved): Approve New Customer Portal?|Dana Whitfield|2026-08-12T15:00:00Z" \
  "init_portal|stage_change|Planning began with checklist (automation)|System|2026-08-12T15:05:00Z" \
  "init_portal|stage_change|Building started|Owen Park|2026-08-21T15:00:00Z" \
  "init_portal|milestone_completed|Milestone completed: Authentication and account shell|Owen Park|2026-08-29T15:00:00Z" \
  "init_portal|health_change|Health set to blocked: milestone Billing integration is blocked|Owen Park|2026-09-21T15:00:00Z" \
  "init_api_v2|stage_change|Building started|Owen Park|2026-04-02T15:00:00Z" \
  "init_api_v2|milestone_completed|Milestone completed: Beta partner rollout|Owen Park|2026-09-14T15:00:00Z" \
  "init_api_v2|launch_requested|Launch review requested; 5 readiness checks generated|Owen Park|2026-09-24T15:00:00Z" \
  "init_api_v2|readiness_completed|Readiness check ready: Security review complete|Owen Park|2026-09-25T15:00:00Z" \
  "init_sso|decision_recorded|Dana Whitfield decided (approved): Approve Enterprise SSO?|Dana Whitfield|2026-01-12T15:00:00Z" \
  "init_sso|launch_approved|Launch approved by Dana Whitfield|Dana Whitfield|2026-04-22T15:00:00Z" \
  "init_sso|capability_created|Now operating; owner Olivia Reyes|Owen Park|2026-05-01T15:00:00Z" \
  "init_sso|observation_recorded|Observation recorded: Support volume dropped after SSO self-service setup shipped|Olivia Reyes|2026-08-05T15:00:00Z" \
  "init_data_export|capability_created|Now operating; owner Olivia Reyes|Owen Park|2026-03-03T15:00:00Z" \
  "init_data_export|observation_recorded|Observation recorded: CSV exports above 500k rows frequently time out|Olivia Reyes|2026-09-20T15:00:00Z" \
  "init_data_export|observation_recorded|Observation recorded: Customers frequently ask for scheduled exports|Olivia Reyes|2026-09-22T15:00:00Z" \
  "init_slack_approvals|idea_submitted|Idea submitted by Sam Ito|Sam Ito|2026-09-22T15:00:00Z" \
  "init_audit_export|idea_submitted|Idea submitted by Sam Ito|Sam Ito|2026-09-25T15:00:00Z"; do
  i=$((i+1)); IFS='|' read -r init type summary actor at <<<"$spec"
  add activitys <<JSON
{"id":"act_$i","initiativeId":"$init","type":"$type","summary":"$summary","actorName":"$actor","occurredAt":"$at"}
JSON
done

echo "Northstar demo data created. Sign in as any of:"
echo "  casey@northstar.local (admin)   dana@northstar.local (decision maker)"
echo "  owen@northstar.local (owner)    olivia@northstar.local (operational owner)"
echo "  sam@northstar.local (contributor); password: $DEMO_PASSWORD"
