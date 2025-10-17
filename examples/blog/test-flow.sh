#!/bin/bash

# Blog Example - Full Flow Test
# This script tests the complete workflow: sign up, sign in, create post, view post

set -e

BASE_URL="http://localhost:3000"
EMAIL="test@example.com"
PASSWORD="Test123!"
NAME="Test User"

echo "🧪 Testing Blog Example Full Flow"
echo "=================================="
echo ""

# Clean up any existing session
rm -f cookies.txt

# Step 1: Sign Up
echo "1️⃣  Creating new user account..."
SIGNUP_RESPONSE=$(curl -s -c cookies.txt -X POST "$BASE_URL/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"$NAME\"}")

echo "   Response: $SIGNUP_RESPONSE"
echo ""

# Step 2: Sign In
echo "2️⃣  Signing in..."
SIGNIN_RESPONSE=$(curl -s -b cookies.txt -c cookies.txt -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

echo "   Response: $SIGNIN_RESPONSE"
echo ""

# Step 3: Create a Post
echo "3️⃣  Creating a blog post..."
POST_DATA='{
  "title": "My First Blog Post",
  "slug": "my-first-post",
  "body": "This is the content of my first blog post. It was created using the ZBL Engine!",
  "status": "published"
}'

CREATE_RESPONSE=$(curl -s -b cookies.txt -X POST "$BASE_URL/api/posts" \
  -H "Content-Type: application/json" \
  -d "$POST_DATA")

echo "   Response: $CREATE_RESPONSE"

# Extract post ID from response
POST_ID=$(echo $CREATE_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"\([^"]*\)"/\1/')
echo "   Created post ID: $POST_ID"
echo ""

# Step 4: View the Post (unauthenticated)
echo "4️⃣  Viewing the post (as unauthenticated user)..."
curl -s "$BASE_URL/posts/$POST_ID" | grep -o '<title>[^<]*</title>' | head -1
echo ""

# Step 5: List all posts
echo "5️⃣  Listing all published posts..."
curl -s "$BASE_URL/posts" | grep -o '<title>[^<]*</title>' | head -1
echo ""

# Step 6: Access Dashboard (authenticated)
echo "6️⃣  Accessing dashboard (authenticated)..."
curl -s -b cookies.txt "$BASE_URL/dashboard" | grep -o '<title>[^<]*</title>' | head -1
echo ""

# Cleanup
rm -f cookies.txt

echo "✅ Full flow test completed successfully!"
