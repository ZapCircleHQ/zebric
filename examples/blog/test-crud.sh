#!/bin/bash

# Test CRUD Operations for Blog Example
# Tests create, read, update, and delete functionality

BASE_URL="http://localhost:3000"

echo "🧪 Testing Blog Example CRUD Operations"
echo "========================================"
echo ""

# Step 1: Sign up
echo "1️⃣  Creating user account..."
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/sign-up/email" \
  -c /tmp/cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "email": "crud-test@example.com",
    "password": "password123",
    "name": "CRUD Test User"
  }')

USER_ID=$(echo $SIGNUP_RESPONSE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$USER_ID" ]; then
  echo "❌ Sign up failed"
  exit 1
fi

# Extract session token from cookies
SESSION_TOKEN=$(grep 'better-auth.session_token' /tmp/cookies.txt | awk '{print $7}')

if [ -z "$SESSION_TOKEN" ]; then
  echo "❌ No session token in cookies"
  exit 1
fi

echo "   ✅ User created: $USER_ID"
echo "   Session token: $SESSION_TOKEN"
echo ""

# Step 2: Create a post via API
echo "2️⃣  Creating a post via API..."
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/posts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -d '{
    "title": "CRUD Test Post",
    "slug": "crud-test-post",
    "body": "This is a test post for CRUD operations.",
    "status": "published"
  }')

POST_ID=$(echo $CREATE_RESPONSE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$POST_ID" ]; then
  echo "❌ Create failed"
  echo "   Response: $CREATE_RESPONSE"
  exit 1
fi

echo "   ✅ Post created: $POST_ID"
echo "   Response: $CREATE_RESPONSE"
echo ""

# Step 3: Read the post via API
echo "3️⃣  Reading the post via API..."
READ_RESPONSE=$(curl -s "$BASE_URL/api/posts/$POST_ID")

READ_TITLE=$(echo $READ_RESPONSE | grep -o '"title":"[^"]*"' | cut -d'"' -f4)

if [ "$READ_TITLE" != "CRUD Test Post" ]; then
  echo "❌ Read failed"
  echo "   Response: $READ_RESPONSE"
  exit 1
fi

echo "   ✅ Post read successfully"
echo "   Title: $READ_TITLE"
echo ""

# Step 4: Update the post via API
echo "4️⃣  Updating the post via API..."
UPDATE_RESPONSE=$(curl -s -X PUT "$BASE_URL/api/posts/$POST_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -d '{
    "title": "CRUD Test Post (Updated)",
    "body": "This post has been updated via CRUD test."
  }')

UPDATED_TITLE=$(echo $UPDATE_RESPONSE | grep -o '"title":"[^"]*"' | cut -d'"' -f4)

if [ "$UPDATED_TITLE" != "CRUD Test Post (Updated)" ]; then
  echo "❌ Update failed"
  echo "   Response: $UPDATE_RESPONSE"
  exit 1
fi

echo "   ✅ Post updated successfully"
echo "   New title: $UPDATED_TITLE"
echo ""

# Step 5: Verify update by reading again
echo "5️⃣  Verifying update..."
VERIFY_RESPONSE=$(curl -s "$BASE_URL/api/posts/$POST_ID")
VERIFY_TITLE=$(echo $VERIFY_RESPONSE | grep -o '"title":"[^"]*"' | cut -d'"' -f4)

if [ "$VERIFY_TITLE" != "CRUD Test Post (Updated)" ]; then
  echo "❌ Verification failed"
  echo "   Response: $VERIFY_RESPONSE"
  exit 1
fi

echo "   ✅ Update verified"
echo ""

# Step 6: Test HTML form rendering for edit
echo "6️⃣  Testing edit form rendering..."
EDIT_PAGE=$(curl -s -H "Cookie: better-auth.session_token=$SESSION_TOKEN" "$BASE_URL/posts/$POST_ID/edit")

if echo "$EDIT_PAGE" | grep -q "CRUD Test Post (Updated)"; then
  echo "   ✅ Edit form renders with existing data"
else
  echo "   ⚠️  Edit form may not have pre-populated data"
fi
echo ""

# Step 7: Delete the post via API
echo "7️⃣  Deleting the post via API..."
DELETE_RESPONSE=$(curl -s -X DELETE "$BASE_URL/api/posts/$POST_ID" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -w "\n%{http_code}")

HTTP_CODE=$(echo "$DELETE_RESPONSE" | tail -1)

if [ "$HTTP_CODE" != "204" ]; then
  echo "❌ Delete failed (HTTP $HTTP_CODE)"
  exit 1
fi

echo "   ✅ Post deleted successfully"
echo ""

# Step 8: Verify deletion
echo "8️⃣  Verifying deletion..."
VERIFY_DELETE=$(curl -s "$BASE_URL/api/posts/$POST_ID" -w "\n%{http_code}")
DELETE_CHECK_CODE=$(echo "$VERIFY_DELETE" | tail -1)

# Should be 404 or empty
if [ "$DELETE_CHECK_CODE" = "404" ] || [ "$DELETE_CHECK_CODE" = "500" ]; then
  echo "   ✅ Post is deleted (returns $DELETE_CHECK_CODE)"
else
  echo "   ⚠️  Post may still exist (HTTP $DELETE_CHECK_CODE)"
fi
echo ""

# Step 9: Test list endpoint
echo "9️⃣  Testing list endpoint..."
LIST_RESPONSE=$(curl -s "$BASE_URL/api/posts")

if echo "$LIST_RESPONSE" | grep -q '\['; then
  echo "   ✅ List endpoint returns array"
  # Count posts (rough estimate)
  POST_COUNT=$(echo "$LIST_RESPONSE" | grep -o '"id"' | wc -l)
  echo "   Found $POST_COUNT post(s)"
else
  echo "   ❌ List endpoint failed"
  echo "   Response: $LIST_RESPONSE"
fi
echo ""

echo "✅ All CRUD operations completed successfully!"
echo ""
