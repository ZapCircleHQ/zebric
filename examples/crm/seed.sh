#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
DEMO_PASSWORD="${DEMO_PASSWORD:-CrmDemo1!}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${DB_PATH:-$SCRIPT_DIR/data/app.db}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT
CSRF_TOKEN="${CSRF_TOKEN:-crm-seed-csrf}"

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

echo "Provisioning CRM demo identities..."
post_auth /api/auth/sign-up/email "{\"email\":\"sarah@crm.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Sarah Kim\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"mike@crm.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Mike Torres\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"jordan@crm.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Jordan Bell\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"nia@crm.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Nia Brooks\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"leo@crm.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Leo Park\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"maya@crm.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Maya Singh\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"manager@crm.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Alex Morgan\"}" >/dev/null || true
post_auth /api/auth/sign-up/email "{\"email\":\"admin@crm.local\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Casey Admin\"}" >/dev/null || true

sqlite3 "$DB_PATH" <<SQL
UPDATE user SET role = 'ae' WHERE email IN ('sarah@crm.local','mike@crm.local','jordan@crm.local');
UPDATE user SET role = 'assistant' WHERE email IN ('nia@crm.local','leo@crm.local','maya@crm.local');
UPDATE user SET role = 'manager' WHERE email = 'manager@crm.local';
UPDATE user SET role = 'admin' WHERE email = 'admin@crm.local';
SQL

SARAH_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='sarah@crm.local' LIMIT 1;")"
MIKE_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='mike@crm.local' LIMIT 1;")"
JORDAN_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='jordan@crm.local' LIMIT 1;")"
NIA_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='nia@crm.local' LIMIT 1;")"
LEO_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='leo@crm.local' LIMIT 1;")"
MAYA_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM user WHERE email='maya@crm.local' LIMIT 1;")"

post_auth /api/auth/sign-in/email "{\"email\":\"admin@crm.local\",\"password\":\"$DEMO_PASSWORD\"}" >/dev/null

if curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/salesteams" | grep -q 'team_sarah'; then
  echo "CRM demo data already exists; leaving it unchanged."
  exit 0
fi

echo "Creating sales teams and memberships..."
post_json /api/salesteams "{\"id\":\"team_sarah\",\"name\":\"Central Texas Growth\",\"accountExecutiveId\":\"$SARAH_ID\",\"accountExecutiveName\":\"Sarah Kim\",\"active\":true}" >/dev/null
post_json /api/salesteams "{\"id\":\"team_mike\",\"name\":\"Texas Enterprise\",\"accountExecutiveId\":\"$MIKE_ID\",\"accountExecutiveName\":\"Mike Torres\",\"active\":true}" >/dev/null
post_json /api/salesteams "{\"id\":\"team_jordan\",\"name\":\"Southwest Expansion\",\"accountExecutiveId\":\"$JORDAN_ID\",\"accountExecutiveName\":\"Jordan Bell\",\"active\":true}" >/dev/null
post_json /api/teammemberships "{\"id\":\"member_sarah\",\"teamId\":\"team_sarah\",\"userId\":\"$SARAH_ID\",\"userEmail\":\"sarah@crm.local\",\"userName\":\"Sarah Kim\",\"teamRole\":\"account_executive\"}" >/dev/null
post_json /api/teammemberships "{\"id\":\"member_nia\",\"teamId\":\"team_sarah\",\"userId\":\"$NIA_ID\",\"userEmail\":\"nia@crm.local\",\"userName\":\"Nia Brooks\",\"teamRole\":\"assistant\"}" >/dev/null
post_json /api/teammemberships "{\"id\":\"member_mike\",\"teamId\":\"team_mike\",\"userId\":\"$MIKE_ID\",\"userEmail\":\"mike@crm.local\",\"userName\":\"Mike Torres\",\"teamRole\":\"account_executive\"}" >/dev/null
post_json /api/teammemberships "{\"id\":\"member_leo\",\"teamId\":\"team_mike\",\"userId\":\"$LEO_ID\",\"userEmail\":\"leo@crm.local\",\"userName\":\"Leo Park\",\"teamRole\":\"assistant\"}" >/dev/null
post_json /api/teammemberships "{\"id\":\"member_jordan\",\"teamId\":\"team_jordan\",\"userId\":\"$JORDAN_ID\",\"userEmail\":\"jordan@crm.local\",\"userName\":\"Jordan Bell\",\"teamRole\":\"account_executive\"}" >/dev/null
post_json /api/teammemberships "{\"id\":\"member_maya\",\"teamId\":\"team_jordan\",\"userId\":\"$MAYA_ID\",\"userEmail\":\"maya@crm.local\",\"userName\":\"Maya Singh\",\"teamRole\":\"assistant\"}" >/dev/null

ACCOUNT_NAMES=("Hill Country Veterinary Group" "Bluebonnet Animal Hospital" "Cedar Park Pet Care" "Round Rock Specialty Vet" "Barton Creek Dental" "Lone Star Physical Therapy" "Capitol Family Medicine" "South Congress Pediatrics" "Lakeway Orthopedics" "Pflugerville Eye Center" "Georgetown Animal Wellness" "North Loop Veterinary Clinic" "Mueller Emergency Vet" "Westlake Pet Hospital" "Brushy Creek Animal Care" "Austin Equine Partners" "Sunset Valley Veterinary" "Bee Cave Pet Medical" "Manor Veterinary Center" "Leander Companion Animal")
CITIES=("Austin" "Austin" "Cedar Park" "Round Rock" "Austin" "Austin" "Austin" "Austin" "Lakeway" "Pflugerville" "Georgetown" "Austin" "Austin" "West Lake Hills" "Round Rock" "Dripping Springs" "Sunset Valley" "Bee Cave" "Manor" "Leander")

echo "Creating 20 accounts..."
for i in $(seq 1 20); do
  idx=$((i-1)); mod=$((i%3))
  if [ "$mod" -eq 1 ]; then owner="$SARAH_ID"; owner_name="Sarah Kim"; team="team_sarah"; assistant="nia@crm.local";
  elif [ "$mod" -eq 2 ]; then owner="$MIKE_ID"; owner_name="Mike Torres"; team="team_mike"; assistant="leo@crm.local";
  else owner="$JORDAN_ID"; owner_name="Jordan Bell"; team="team_jordan"; assistant="maya@crm.local"; fi
  status="customer"; [ "$i" -gt 15 ] && status="prospect"
  industry="Veterinary Services"; [ "$i" -ge 5 ] && [ "$i" -le 10 ] && industry="Healthcare"
  last='"2026-09-20T15:00:00Z"'; [ "$i" -eq 6 ] && last="null"
  post_json /api/crmaccounts "{\"id\":\"acct_$i\",\"name\":\"${ACCOUNT_NAMES[$idx]}\",\"website\":\"https://example-$i.test\",\"phone\":\"+1-512-555-$(printf '%04d' "$i")\",\"address\":\"$((100+i)) Demo Avenue\",\"city\":\"${CITIES[$idx]}\",\"state\":\"TX\",\"postalCode\":\"78701\",\"latitude\":30.$((20+i)),\"longitude\":-97.$((70+i)),\"industry\":\"$industry\",\"status\":\"$status\",\"ownerId\":\"$owner\",\"ownerName\":\"$owner_name\",\"teamId\":\"$team\",\"assistantEmail\":\"$assistant\",\"source\":\"manual\",\"lastActivityAt\":$last,\"nextAction\":\"Confirm Q4 planning call\",\"tags\":\"central-texas,priority-$mod\"}" >/dev/null
done

echo "Creating 30 contacts..."
FIRST=(Avery Morgan Riley Cameron Quinn Parker Rowan Taylor Reese Skyler)
LAST=(Nguyen Patel Garcia Johnson Williams Brown Davis Wilson Martinez Anderson)
for i in $(seq 1 30); do
  account=$(( (i-1)%20 + 1 )); mod=$((account%3)); first="${FIRST[$((i%10))]}"; last="${LAST[$(((i+3)%10))]}"
  if [ "$mod" -eq 1 ]; then owner="$SARAH_ID"; owner_name="Sarah Kim"; assistant="nia@crm.local";
  elif [ "$mod" -eq 2 ]; then owner="$MIKE_ID"; owner_name="Mike Torres"; assistant="leo@crm.local";
  else owner="$JORDAN_ID"; owner_name="Jordan Bell"; assistant="maya@crm.local"; fi
  post_json /api/contacts "{\"id\":\"contact_$i\",\"accountId\":\"acct_$account\",\"firstName\":\"$first\",\"lastName\":\"$last\",\"email\":\"contact$i@example.test\",\"phone\":\"+1-512-555-$(printf '%04d' $((100+i)))\",\"title\":\"$( [ $((i%2)) -eq 0 ] && echo 'Practice Manager' || echo 'Owner' )\",\"status\":\"active\",\"ownerId\":\"$owner\",\"ownerName\":\"$owner_name\",\"assistantEmail\":\"$assistant\",\"source\":\"manual\"}" >/dev/null
done

echo "Creating leads and opportunities across lifecycle states..."
for i in $(seq 1 12); do
  mod=$((i%3)); status="new"; [ "$i" -gt 4 ] && status="researching"; [ "$i" -gt 8 ] && status="qualified"
  if [ "$mod" -eq 1 ]; then owner="$SARAH_ID"; owner_name="Sarah Kim"; team="team_sarah"; assistant="nia@crm.local";
  elif [ "$mod" -eq 2 ]; then owner="$MIKE_ID"; owner_name="Mike Torres"; team="team_mike"; assistant="leo@crm.local";
  else owner="$JORDAN_ID"; owner_name="Jordan Bell"; team="team_jordan"; assistant="maya@crm.local"; fi
  post_json /api/leads "{\"id\":\"lead_$i\",\"companyName\":\"Texas Prospect $i\",\"firstName\":\"Prospect\",\"lastName\":\"$i\",\"email\":\"prospect$i@example.test\",\"phone\":\"+1-512-555-$(printf '%04d' $((200+i)))\",\"website\":\"https://prospect-$i.test\",\"source\":\"$( [ $((i%2)) -eq 0 ] && echo 'google_places' || echo 'referral' )\",\"status\":\"$status\",\"qualificationNotes\":\"Multi-location practice with a visible growth signal.\",\"nextAction\":\"Identify operations decision maker\",\"ownerId\":\"$owner\",\"ownerName\":\"$owner_name\",\"teamId\":\"$team\",\"assistantEmail\":\"$assistant\"}" >/dev/null
done

STAGES=(discovery qualified proposal negotiation won lost)
for i in $(seq 1 15); do
  account=$(( (i-1)%15 + 1 )); mod=$((account%3)); stage="${STAGES[$((i%6))]}"; status="open"; [ "$stage" = "won" ] && status="won"; [ "$stage" = "lost" ] && status="lost"
  if [ "$mod" -eq 1 ]; then owner="$SARAH_ID"; owner_name="Sarah Kim"; team="team_sarah"; assistant="nia@crm.local";
  elif [ "$mod" -eq 2 ]; then owner="$MIKE_ID"; owner_name="Mike Torres"; team="team_mike"; assistant="leo@crm.local";
  else owner="$JORDAN_ID"; owner_name="Jordan Bell"; team="team_jordan"; assistant="maya@crm.local"; fi
  post_json /api/opportunitys "{\"id\":\"opp_$i\",\"name\":\"Annual services agreement $i\",\"accountId\":\"acct_$account\",\"ownerId\":\"$owner\",\"ownerName\":\"$owner_name\",\"teamId\":\"$team\",\"assistantEmail\":\"$assistant\",\"stage\":\"$stage\",\"amount\":$((18000+i*3500)),\"probability\":$((10+(i%5)*20)),\"expectedCloseDate\":\"2026-10-$(printf '%02d' $((5+i)))\",\"nextAction\":\"Review stakeholder feedback\",\"status\":\"$status\",\"lastActivityAt\":\"2026-09-24T16:00:00Z\"}" >/dev/null
done

echo "Creating prospect search and staged Google Places candidates..."
post_json /api/prospectsearchs "{\"id\":\"search_vets_austin\",\"query\":\"independent veterinary clinics\",\"location\":\"Round Rock, Texas\",\"latitude\":30.5083,\"longitude\":-97.6789,\"radiusMeters\":32187,\"status\":\"completed\",\"requestedById\":\"crm-sales-agent\",\"requestedByType\":\"agent\",\"ownerId\":\"$SARAH_ID\",\"ownerName\":\"Sarah Kim\",\"assistantEmail\":\"nia@crm.local\",\"resultCount\":8,\"externalRequestId\":\"demo-places-request\",\"completedAt\":\"2026-09-27T15:00:00Z\"}" >/dev/null
for i in $(seq 1 8); do
  disposition="recommended"; [ "$i" -eq 3 ] && disposition="potential_duplicate"; team="team_sarah"; owner="$SARAH_ID"; owner_name="Sarah Kim"; assistant="nia@crm.local"
  [ "$i" -gt 4 ] && team="team_mike" && owner="$MIKE_ID" && owner_name="Mike Torres" && assistant="leo@crm.local"
  duplicate="null"; [ "$i" -eq 3 ] && duplicate='"acct_3"'
  post_json /api/prospectcandidates "{\"id\":\"candidate_$i\",\"searchId\":\"search_vets_austin\",\"externalSource\":\"google_places\",\"externalId\":\"places-demo-$i\",\"name\":\"North Austin Veterinary Candidate $i\",\"address\":\"$((600+i)) Research Blvd, Austin, TX\",\"city\":\"Austin\",\"latitude\":30.$((40+i)),\"longitude\":-97.$((60+i)),\"category\":\"veterinary_care\",\"rating\":4.$((i%5)),\"reviewCount\":$((35+i*17)),\"website\":\"https://candidate-$i.test\",\"phone\":\"+1-512-555-$(printf '%04d' $((400+i)))\",\"evaluation\":\"Independent clinic with strong reviews and local growth indicators.\",\"score\":$((92-i*3)),\"disposition\":\"$disposition\",\"potentialDuplicateAccountId\":$duplicate,\"ownerId\":\"$owner\",\"ownerName\":\"$owner_name\",\"teamId\":\"$team\",\"assistantEmail\":\"$assistant\"}" >/dev/null
done

echo "Creating conversations, messages, tasks, activities, and insights..."
post_json /api/conversations '{"id":"conv_outreach_1","subject":"Reducing missed appointments","accountId":"acct_1","contactId":"contact_1","ownerId":"'"$SARAH_ID"'","ownerName":"Sarah Kim","assistantEmail":"nia@crm.local","status":"open","lastMessageAt":"2026-09-27T14:00:00Z"}' >/dev/null
post_json /api/messages '{"id":"msg_draft_1","conversationId":"conv_outreach_1","accountId":"acct_1","contactId":"contact_1","direction":"outbound","sender":"sales@example.test","recipients":"contact1@example.test","subject":"A simpler follow-up workflow","body":"Hi Avery, I prepared a brief idea for your practice team.","status":"pending_review","approvalRequired":true,"reviewerId":"'"$NIA_ID"'","reviewerName":"Nia Brooks","ownerId":"'"$SARAH_ID"'","ownerName":"Sarah Kim","assistantEmail":"nia@crm.local","initiatedById":"'"$SARAH_ID"'","createdByType":"agent"}' >/dev/null
post_json /api/messages '{"id":"msg_reply_1","conversationId":"conv_outreach_1","accountId":"acct_1","contactId":"contact_1","direction":"inbound","sender":"contact1@example.test","recipients":"sales@example.test","subject":"Re: A simpler follow-up workflow","body":"This sounds useful. Could we see a demo next week?","sendGridId":"sg-demo-inbound-1","status":"received","approvalRequired":false,"classification":"interested","classificationReason":"The sender explicitly asks for a demo.","classificationModel":"gpt-4o-mini","ownerId":"'"$SARAH_ID"'","ownerName":"Sarah Kim","assistantEmail":"nia@crm.local","createdByType":"system","receivedAt":"2026-09-28T14:30:00Z"}' >/dev/null
post_json /api/tasks '{"id":"task_review_1","title":"Review outreach to Hill Country Veterinary Group","description":"Review the personalized draft before sending.","type":"review_outreach","status":"open","priority":"high","assigneeId":"'"$NIA_ID"'","assigneeName":"Nia Brooks","ownerId":"'"$SARAH_ID"'","assistantEmail":"nia@crm.local","accountId":"acct_1","messageId":"msg_draft_1","dueAt":"2026-09-29T15:00:00Z","createdByType":"workflow"}' >/dev/null
post_json /api/tasks '{"id":"task_reply_1","title":"Schedule requested demo","description":"Interested reply received; propose two times.","type":"investigate_reply","status":"open","priority":"urgent","assigneeId":"'"$SARAH_ID"'","assigneeName":"Sarah Kim","ownerId":"'"$SARAH_ID"'","assistantEmail":"nia@crm.local","accountId":"acct_1","messageId":"msg_reply_1","dueAt":"2026-09-29T16:00:00Z","createdByType":"workflow"}' >/dev/null

for i in $(seq 1 12); do
  account=$(( (i-1)%12 + 1 )); mod=$((account%3))
  if [ "$mod" -eq 1 ]; then owner="$SARAH_ID"; owner_name="Sarah Kim"; assistant="nia@crm.local"; elif [ "$mod" -eq 2 ]; then owner="$MIKE_ID"; owner_name="Mike Torres"; assistant="leo@crm.local"; else owner="$JORDAN_ID"; owner_name="Jordan Bell"; assistant="maya@crm.local"; fi
  post_json /api/activitys "{\"id\":\"activity_$i\",\"accountId\":\"acct_$account\",\"opportunityId\":\"opp_$account\",\"type\":\"$( [ $((i%3)) -eq 0 ] && echo 'meeting' || echo 'note' )\",\"summary\":\"Discussed rollout goals and recorded next steps.\",\"actorType\":\"$( [ $((i%4)) -eq 0 ] && echo 'agent' || echo 'user' )\",\"actorId\":\"$owner\",\"actorName\":\"$owner_name\",\"command\":\"logInteraction\",\"ownerId\":\"$owner\",\"assistantEmail\":\"$assistant\",\"occurredAt\":\"2026-09-2$((i%8))T15:00:00Z\"}" >/dev/null
done

post_json /api/insights '{"id":"insight_stale_1","type":"stale_account","accountId":"acct_6","ownerId":"'"$JORDAN_ID"'","ownerName":"Jordan Bell","assistantEmail":"maya@crm.local","severity":"high","summary":"Capitol Family Medicine has no recorded activity","evidence":"lastActivityAt is empty while the account remains a customer.","suggestedAction":"Schedule a relationship check-in","generatedAt":"2026-09-28T12:00:00Z","expiresAt":"2026-10-05T12:00:00Z","status":"open","generator":"deterministic:stale-account-v1"}' >/dev/null
post_json /api/insights '{"id":"insight_next_1","type":"opportunity_without_next_action","accountId":"acct_4","opportunityId":"opp_4","ownerId":"'"$SARAH_ID"'","ownerName":"Sarah Kim","assistantEmail":"nia@crm.local","severity":"medium","summary":"Round Rock opportunity needs a concrete next action","evidence":"The opportunity is open and closing soon; its next step has not been confirmed after the last meeting.","suggestedAction":"Create a follow-up task","generatedAt":"2026-09-28T12:00:00Z","expiresAt":"2026-10-05T12:00:00Z","status":"open","generator":"deterministic:next-action-v1"}' >/dev/null
post_json /api/insights '{"id":"insight_interested_1","type":"interested_prospect","accountId":"acct_1","contactId":"contact_1","ownerId":"'"$SARAH_ID"'","ownerName":"Sarah Kim","assistantEmail":"nia@crm.local","severity":"urgent","summary":"Hill Country requested a demo","evidence":"Inbound message msg_reply_1 was classified interested because the sender asked to see a demo next week.","suggestedAction":"Schedule the demo within one business day","generatedAt":"2026-09-28T14:35:00Z","expiresAt":"2026-10-02T14:35:00Z","status":"open","generator":"classification-rule-v1"}' >/dev/null

echo "Zebric CRM is ready at $BASE_URL"
echo "Demo password: $DEMO_PASSWORD"
echo "  AE         sarah@crm.local, mike@crm.local, jordan@crm.local"
echo "  Assistant  nia@crm.local, leo@crm.local, maya@crm.local"
echo "  Manager    manager@crm.local"
echo "  Admin      admin@crm.local"
