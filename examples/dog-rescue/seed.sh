#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
DEMO_PASSWORD="${DEMO_PASSWORD:-FriendlyPaws!Demo1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${DB_PATH:-$SCRIPT_DIR/data/app.db}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

curl -sS -c "$COOKIE_JAR" "$BASE/" > /dev/null
CSRF="$(grep csrf-token "$COOKIE_JAR" | awk '{print $NF}')"

post_json() {
  curl -sS -X POST "$BASE$1" \
    -b "$COOKIE_JAR" \
    -H "x-csrf-token: $CSRF" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$2"
}

# Better Auth's own routes (unlike the generic entity API) require a matching Origin
# header on state-changing requests, and sign-in needs to update the cookie jar.
post_auth() {
  curl -sS -X POST "$BASE$1" \
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "x-csrf-token: $CSRF" \
    -H "Origin: $BASE" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$2"
}

extract_id() {
  python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])'
}

# Staff accounts are provisioned here, not self-registered: sign-up never accepts a
# client-supplied role (see BetterAuthProvider), so assigning one is a deliberate,
# separate, trusted step - exactly the "no public self-serve staff access" this demo
# is meant to model. A real deployment would do the equivalent through an internal
# admin tool instead of a direct database write.
echo "Creating staff logins..."
post_auth /api/auth/sign-up/email "{\"email\":\"maya@friendlypaws.example\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Maya Brooks\"}" >/dev/null
post_auth /api/auth/sign-up/email "{\"email\":\"eli@friendlypaws.example\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Eli Turner\"}" >/dev/null
post_auth /api/auth/sign-up/email "{\"email\":\"rina@friendlypaws.example\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Rina Shah\"}" >/dev/null

echo "Assigning staff roles..."
sqlite3 "$DB_PATH" <<SQL
UPDATE user SET role = 'volunteer' WHERE email = 'maya@friendlypaws.example';
UPDATE user SET role = 'coordinator' WHERE email = 'eli@friendlypaws.example';
UPDATE user SET role = 'admin' WHERE email = 'rina@friendlypaws.example';
SQL

# The rest of this script seeds operational data as the admin account: with anonymous
# access scoped down to just Dog.read + AdoptionInterest.create, these direct /api/*
# writes need a real, permitted session (see GAP_ANALYSIS.md for why AdoptionInterest
# itself is still exercised live, not scripted here).
echo "Signing in as admin (Rina) to seed operational data..."
post_auth /api/auth/sign-in/email "{\"email\":\"rina@friendlypaws.example\",\"password\":\"$DEMO_PASSWORD\"}" >/dev/null

echo "Creating volunteers..."
MAYA=$(post_json /api/volunteers '{"name":"Maya Brooks","email":"maya@friendlypaws.example","role":"Volunteer","active":true}' | extract_id)
ELI=$(post_json /api/volunteers '{"name":"Eli Turner","email":"eli@friendlypaws.example","role":"Adoption Coordinator","active":true}' | extract_id)
RINA=$(post_json /api/volunteers '{"name":"Rina Shah","email":"rina@friendlypaws.example","role":"Admin","active":true}' | extract_id)

echo "Creating dogs..."
BELLA=$(post_json /api/dogs '{"name":"Bella","breed":"Labrador Mix","age":3,"weight":48,"sex":"Female","photoUrl":"https://images.unsplash.com/photo-1552053831-71594a27632d","status":"Available","temperament":"Affectionate, steady, eager to please.","energyLevel":"Moderate","goodWithKids":true,"goodWithDogs":true,"goodWithCats":false,"medicalNotes":"Spayed, vaccinated, mild seasonal allergies.","fosterHome":"Maya Brooks","adoptionFee":275}' | extract_id)
MILO=$(post_json /api/dogs '{"name":"Milo","breed":"Beagle","age":2,"weight":26,"sex":"Male","photoUrl":"https://images.unsplash.com/photo-1505628346881-b72b27e84530","status":"Application Pending","temperament":"Curious and food-motivated.","energyLevel":"High","goodWithKids":true,"goodWithDogs":true,"goodWithCats":true,"medicalNotes":"Healthy.","fosterHome":"Eli Turner","adoptionFee":250}' | extract_id)
LUNA=$(post_json /api/dogs '{"name":"Luna","breed":"Australian Shepherd","age":1.5,"weight":36,"sex":"Female","photoUrl":"https://images.unsplash.com/photo-1548199973-03cce0bbc87b","status":"Meet & Greet Required","temperament":"Smart, alert, bonds quickly.","energyLevel":"High","goodWithKids":false,"goodWithDogs":true,"goodWithCats":false,"medicalNotes":"Needs structured exercise.","fosterHome":"Rina Shah","adoptionFee":300}' | extract_id)
ROCKY=$(post_json /api/dogs '{"name":"Rocky","breed":"Boxer","age":5,"weight":62,"sex":"Male","photoUrl":"https://images.unsplash.com/photo-1587300003388-59208cc962cb","status":"Pending Pickup","temperament":"Goofy and people-focused.","energyLevel":"Moderate","goodWithKids":true,"goodWithDogs":false,"goodWithCats":false,"medicalNotes":"Recovering well from dental cleaning.","fosterHome":"Maya Brooks","adoptionFee":225}' | extract_id)
DAISY=$(post_json /api/dogs '{"name":"Daisy","breed":"Terrier Mix","age":0.7,"weight":18,"sex":"Female","photoUrl":"https://images.unsplash.com/photo-1517849845537-4d257902454a","status":"Available","temperament":"Playful puppy, needs training.","energyLevel":"High","goodWithKids":true,"goodWithDogs":true,"goodWithCats":true,"medicalNotes":"Puppy vaccine series in progress.","fosterHome":"Eli Turner","adoptionFee":325}' | extract_id)
COOPER=$(post_json /api/dogs '{"name":"Cooper","breed":"Golden Retriever","age":4,"weight":70,"sex":"Male","photoUrl":"https://images.unsplash.com/photo-1558788353-f76d92427f16","status":"Available","temperament":"Gentle and social.","energyLevel":"Moderate","goodWithKids":true,"goodWithDogs":true,"goodWithCats":true,"medicalNotes":"Healthy.","fosterHome":"Rina Shah","adoptionFee":300}' | extract_id)
NALA=$(post_json /api/dogs '{"name":"Nala","breed":"Pit Bull Mix","age":6,"weight":54,"sex":"Female","photoUrl":"https://images.unsplash.com/photo-1561037404-61cd46aa615b","status":"Foster","temperament":"Calm, loyal, prefers quiet homes.","energyLevel":"Low","goodWithKids":false,"goodWithDogs":false,"goodWithCats":false,"medicalNotes":"Arthritis management plan.","fosterHome":"Maya Brooks","adoptionFee":175}' | extract_id)
OLLIE=$(post_json /api/dogs '{"name":"Ollie","breed":"Corgi","age":3,"weight":29,"sex":"Male","photoUrl":"https://images.unsplash.com/photo-1612536057832-2ff7ead58194","status":"Available","temperament":"Confident and funny.","energyLevel":"Moderate","goodWithKids":true,"goodWithDogs":true,"goodWithCats":false,"medicalNotes":"Healthy.","fosterHome":"Eli Turner","adoptionFee":300}' | extract_id)
SADIE=$(post_json /api/dogs '{"name":"Sadie","breed":"German Shepherd","age":7,"weight":74,"sex":"Female","photoUrl":"https://images.unsplash.com/photo-1589941013453-ec89f33b5e95","status":"Intake","temperament":"Observant and cautious.","energyLevel":"Moderate","goodWithKids":false,"goodWithDogs":true,"goodWithCats":false,"medicalNotes":"Intake exam pending.","fosterHome":"Rina Shah","adoptionFee":200}' | extract_id)
FINN=$(post_json /api/dogs '{"name":"Finn","breed":"Poodle Mix","age":2,"weight":22,"sex":"Male","photoUrl":"https://images.unsplash.com/photo-1537151625747-768eb6cf92b2","status":"Adopted","temperament":"Bright and cuddly.","energyLevel":"Moderate","goodWithKids":true,"goodWithDogs":true,"goodWithCats":true,"medicalNotes":"Healthy.","fosterHome":"Maya Brooks","adoptionFee":275}' | extract_id)

echo "Creating applicants..."
SARAH=$(post_json /api/applicants '{"firstName":"Sarah","lastName":"Chen","email":"sarah.chen@example.com","phone":"555-0101","address":"120 Maple Ave","city":"Austin","state":"TX","zip":"78701","ownsOrRents":"Rents","landlordApprovalRequired":true,"hasExistingPets":true,"existingDogsCount":1,"existingCatsCount":0,"previousDogExperience":"Grew up with labs and currently has one senior dog.","householdNotes":"Works from home most days."}' | extract_id)
MIGUEL=$(post_json /api/applicants '{"firstName":"Miguel","lastName":"Rodriguez","email":"miguel.rodriguez@example.com","phone":"555-0102","address":"88 Cedar St","city":"Austin","state":"TX","zip":"78702","ownsOrRents":"Owns","landlordApprovalRequired":false,"hasExistingPets":false,"existingDogsCount":0,"existingCatsCount":0,"previousDogExperience":"First-time adopter, completed local training class.","householdNotes":"Quiet adult household."}' | extract_id)
PRIYA=$(post_json /api/applicants '{"firstName":"Priya","lastName":"Patel","email":"priya.patel@example.com","phone":"555-0103","address":"45 Lake Dr","city":"Round Rock","state":"TX","zip":"78664","ownsOrRents":"Owns","landlordApprovalRequired":false,"hasExistingPets":true,"existingDogsCount":0,"existingCatsCount":2,"previousDogExperience":"Volunteered with a shelter in college.","householdNotes":"Needs cat-friendly placement."}' | extract_id)
JAMES=$(post_json /api/applicants '{"firstName":"James","lastName":"Miller","email":"james.miller@example.com","phone":"555-0104","address":"9 Pine Ct","city":"Cedar Park","state":"TX","zip":"78613","ownsOrRents":"Rents","landlordApprovalRequired":true,"hasExistingPets":false,"existingDogsCount":0,"existingCatsCount":0,"previousDogExperience":"Had a boxer for 11 years.","householdNotes":"Landlord allows one dog under 75 pounds."}' | extract_id)
ANA=$(post_json /api/applicants '{"firstName":"Ana","lastName":"Lopez","email":"ana.lopez@example.com","phone":"555-0105","address":"301 River Rd","city":"Austin","state":"TX","zip":"78703","ownsOrRents":"Owns","landlordApprovalRequired":false,"hasExistingPets":true,"existingDogsCount":2,"existingCatsCount":0,"previousDogExperience":"Experienced adopter with two friendly dogs.","householdNotes":"Large fenced yard."}' | extract_id)

echo "Creating applications..."
APP1=$(post_json /api/adoptionapplications "{\"dogId\":\"$MILO\",\"applicantId\":\"$SARAH\",\"status\":\"Submitted\",\"meetAndGreetRequired\":true,\"meetAndGreetReason\":\"Applicant has existing pets\"}" | extract_id)
APP2=$(post_json /api/adoptionapplications "{\"dogId\":\"$LUNA\",\"applicantId\":\"$PRIYA\",\"status\":\"Meet & Greet Required\",\"meetAndGreetRequired\":true,\"meetAndGreetReason\":\"Applicant has cats\"}" | extract_id)
APP3=$(post_json /api/adoptionapplications "{\"dogId\":\"$ROCKY\",\"applicantId\":\"$JAMES\",\"status\":\"Approved\",\"reviewedBy\":\"$ELI\",\"meetAndGreetRequired\":false,\"homeVisitRequired\":false,\"decision\":\"Approved\",\"decisionNotes\":\"Strong match\"}" | extract_id)
APP4=$(post_json /api/adoptionapplications "{\"dogId\":\"$FINN\",\"applicantId\":\"$MIGUEL\",\"status\":\"Completed\",\"reviewedBy\":\"$MAYA\",\"meetAndGreetRequired\":false,\"homeVisitRequired\":false,\"decision\":\"Completed\",\"decisionNotes\":\"Adoption completed\"}" | extract_id)
APP5=$(post_json /api/adoptionapplications "{\"dogId\":\"$DAISY\",\"applicantId\":\"$ANA\",\"status\":\"Home Visit Required\",\"reviewedBy\":\"$ELI\",\"meetAndGreetRequired\":true,\"meetAndGreetReason\":\"Two existing dogs\",\"homeVisitRequired\":true}" | extract_id)

echo "Creating tasks..."
post_json /api/tasks "{\"title\":\"Schedule Meet & Greet\",\"description\":\"Sarah has an existing dog.\",\"assignedTo\":\"$MAYA\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP1\",\"status\":\"Open\",\"dueDate\":\"2026-07-08\",\"priority\":\"High\",\"createdByWorkflow\":true}" >/dev/null
post_json /api/tasks "{\"title\":\"Call Sarah about landlord approval\",\"description\":\"Confirm rental approval before next step.\",\"assignedTo\":\"$MAYA\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP1\",\"status\":\"Open\",\"dueDate\":\"2026-07-07\",\"priority\":\"Normal\",\"createdByWorkflow\":true}" >/dev/null
post_json /api/tasks "{\"title\":\"Schedule Luna cat-safe introduction\",\"description\":\"Priya has two cats.\",\"assignedTo\":\"$ELI\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP2\",\"status\":\"In Progress\",\"dueDate\":\"2026-07-09\",\"priority\":\"High\",\"createdByWorkflow\":true}" >/dev/null
post_json /api/tasks "{\"title\":\"Prepare Rocky pickup packet\",\"description\":\"Print final paperwork and care notes.\",\"assignedTo\":\"$ELI\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP3\",\"status\":\"Open\",\"dueDate\":\"2026-07-05\",\"priority\":\"Urgent\",\"createdByWorkflow\":true}" >/dev/null
post_json /api/tasks "{\"title\":\"Send Finn welcome packet\",\"description\":\"Follow up with adopter resources.\",\"assignedTo\":\"$RINA\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP4\",\"status\":\"Completed\",\"dueDate\":\"2026-07-01\",\"priority\":\"Normal\",\"createdByWorkflow\":true}" >/dev/null
post_json /api/tasks "{\"title\":\"Schedule Daisy home visit\",\"description\":\"Coordinator required a home visit.\",\"assignedTo\":\"$ELI\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP5\",\"status\":\"Open\",\"dueDate\":\"2026-07-10\",\"priority\":\"High\",\"createdByWorkflow\":true}" >/dev/null
post_json /api/tasks "{\"title\":\"Update Sadie intake notes\",\"description\":\"Add vet exam results after intake appointment.\",\"assignedTo\":\"$RINA\",\"relatedEntityType\":\"Dog\",\"relatedEntityId\":\"$SADIE\",\"status\":\"Open\",\"dueDate\":\"2026-07-06\",\"priority\":\"Normal\",\"createdByWorkflow\":false}" >/dev/null
post_json /api/tasks "{\"title\":\"Refresh Bella profile photo\",\"description\":\"Upload a brighter public listing image.\",\"assignedTo\":\"$MAYA\",\"relatedEntityType\":\"Dog\",\"relatedEntityId\":\"$BELLA\",\"status\":\"Open\",\"dueDate\":\"2026-07-11\",\"priority\":\"Low\",\"createdByWorkflow\":false}" >/dev/null

echo "Creating messages, activity, and workflow history..."
post_json /api/outgoingmessages "{\"toEmail\":\"sarah.chen@example.com\",\"subject\":\"Thanks for your interest in Milo\",\"body\":\"Hi Sarah, thank you for your interest in adopting Milo.\",\"template\":\"applicant-confirmation\",\"status\":\"Simulated\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP1\"}" >/dev/null
post_json /api/outgoingmessages "{\"toEmail\":\"volunteers@friendlypaws.example\",\"subject\":\"New adoption application for Milo\",\"body\":\"A new adoption application has been submitted for Milo.\",\"template\":\"volunteer-notification\",\"status\":\"Simulated\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP1\"}" >/dev/null
post_json /api/outgoingmessages "{\"toEmail\":\"james.miller@example.com\",\"subject\":\"Your application for Rocky has been approved\",\"body\":\"Good news! Your application to adopt Rocky has been approved.\",\"template\":\"approval-email\",\"status\":\"Simulated\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP3\"}" >/dev/null

post_json /api/activityevents "{\"actor\":\"System\",\"eventType\":\"Application submitted\",\"summary\":\"Application submitted for Milo\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP1\",\"metadata\":{\"dogId\":\"$MILO\"}}" >/dev/null
post_json /api/activityevents "{\"actor\":\"System\",\"eventType\":\"Meet & greet rule applied\",\"summary\":\"Meet & Greet Required: applicant has existing pets\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP1\",\"metadata\":{\"rule\":\"existing-pets-require-meet-and-greet\"}}" >/dev/null
post_json /api/activityevents "{\"actor\":\"Adoption Coordinator\",\"eventType\":\"Application approved\",\"summary\":\"Application approved and dog status updated to Pending Pickup\",\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP3\",\"metadata\":{\"dogId\":\"$ROCKY\"}}" >/dev/null

post_json /api/workflowexecutions "{\"name\":\"Submit Adoption Interest\",\"trigger\":\"Applicant submits adoption form\",\"steps\":\"Create applicant\nCreate adoption application\nGenerate confirmation email\nGenerate volunteer notification\nEvaluate business rules\nCreate meet-and-greet task\nUpdate dog status\nLog activity\",\"status\":\"Completed\",\"durationMs\":61,\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP1\"}" >/dev/null
post_json /api/workflowexecutions "{\"name\":\"Approve Application\",\"trigger\":\"Adoption Coordinator clicks Approve\",\"steps\":\"Set application status to Approved\nSet dog status to Pending Pickup\nGenerate approval email\nCreate pickup scheduling task\nLog activity\",\"status\":\"Completed\",\"durationMs\":43,\"relatedEntityType\":\"AdoptionApplication\",\"relatedEntityId\":\"$APP3\"}" >/dev/null

echo "Done."
echo "Open $BASE and use Bella for the public submission demo:"
echo "  $BASE/dogs/$BELLA"
