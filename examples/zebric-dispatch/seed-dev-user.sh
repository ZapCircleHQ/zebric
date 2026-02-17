#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
CSRF_TOKEN="${CSRF_TOKEN:-dispatchdevtoken}"
DEV_EMAIL="${DEV_EMAIL:-dev@zebric.local}"
DEV_PASSWORD="${DEV_PASSWORD:-DevPass123!}"
DEV_NAME="${DEV_NAME:-Dispatch Developer}"
COOKIE_JAR="${COOKIE_JAR:-.dev-user.cookies}"

SIGNUP_PAYLOAD=$(cat <<JSON
{"email":"$DEV_EMAIL","password":"$DEV_PASSWORD","name":"$DEV_NAME"}
JSON
)
SIGNIN_PAYLOAD=$(cat <<JSON
{"email":"$DEV_EMAIL","password":"$DEV_PASSWORD"}
JSON
)

printf "Seeding dev user against %s\n" "$BASE_URL"
printf "Email: %s\n" "$DEV_EMAIL"

# 1) Try sign-up (idempotent: proceed if user already exists)
SIGNUP_HTTP=$(curl -sS -o /tmp/zebric-signup.json -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "content-type: application/json" \
  -X POST "$BASE_URL/api/auth/sign-up/email" \
  -d "$SIGNUP_PAYLOAD" || true)

SIGNUP_BODY=$(cat /tmp/zebric-signup.json 2>/dev/null || true)
if [[ "$SIGNUP_HTTP" == "200" || "$SIGNUP_HTTP" == "201" ]]; then
  printf "Created dev user.\n"
else
  if echo "$SIGNUP_BODY" | grep -qi "exist"; then
    printf "Dev user already exists, continuing.\n"
  else
    printf "Sign-up returned HTTP %s (continuing to sign-in): %s\n" "$SIGNUP_HTTP" "$SIGNUP_BODY"
  fi
fi

# 2) Sign in and persist auth cookie
SIGNIN_HTTP=$(curl -sS -o /tmp/zebric-signin.json -w "%{http_code}" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "content-type: application/json" \
  -X POST "$BASE_URL/api/auth/sign-in/email" \
  -d "$SIGNIN_PAYLOAD")

if [[ "$SIGNIN_HTTP" != "200" && "$SIGNIN_HTTP" != "201" ]]; then
  printf "Sign-in failed (HTTP %s): %s\n" "$SIGNIN_HTTP" "$(cat /tmp/zebric-signin.json 2>/dev/null || true)"
  exit 1
fi

SESSION_TOKEN=$(awk '/better-auth\.session_token/ {print $7}' "$COOKIE_JAR" | tail -n 1)
if [[ -z "$SESSION_TOKEN" ]]; then
  printf "Sign-in succeeded but no session cookie was found in %s\n" "$COOKIE_JAR"
  exit 1
fi

printf "Dev user authenticated.\n"
printf "Cookie jar: %s\n" "$COOKIE_JAR"
printf "Session token: %s\n" "$SESSION_TOKEN"
printf "\nUse with curl:\n"
printf "curl -b %s %s/\n" "$COOKIE_JAR" "$BASE_URL"
