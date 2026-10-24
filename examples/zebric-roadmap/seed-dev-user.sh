#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
CSRF_TOKEN="${CSRF_TOKEN:-roadmapdevtoken}"
DEV_EMAIL="${DEV_EMAIL:-roadmap@zebric.local}"
DEV_PASSWORD="${DEV_PASSWORD:-RoadmapPass123!}"
DEV_NAME="${DEV_NAME:-Roadmap Editor}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${DB_PATH:-$SCRIPT_DIR/data/app.db}"
SEED_DIR="$(mktemp -d)"
COOKIE_JAR="${COOKIE_JAR:-$SCRIPT_DIR/.dev-user.cookies}"
trap 'rm -rf "$SEED_DIR"' EXIT

SIGNUP_PAYLOAD="{\"email\":\"$DEV_EMAIL\",\"password\":\"$DEV_PASSWORD\",\"name\":\"$DEV_NAME\"}"
SIGNIN_PAYLOAD="{\"email\":\"$DEV_EMAIL\",\"password\":\"$DEV_PASSWORD\"}"

printf 'Seeding roadmap editor against %s\n' "$BASE_URL"

SIGNUP_HTTP=$(curl -sS -o "$SEED_DIR/signup.json" -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Origin: $BASE_URL" \
  -H "content-type: application/json" \
  -X POST "$BASE_URL/api/auth/sign-up/email" \
  -d "$SIGNUP_PAYLOAD" || true)

if [[ "$SIGNUP_HTTP" == "200" || "$SIGNUP_HTTP" == "201" ]]; then
  printf 'Created %s.\n' "$DEV_EMAIL"
else
  printf 'Sign-up returned HTTP %s; attempting sign-in for an existing user.\n' "$SIGNUP_HTTP"
fi

# This seed is a trusted local provisioning tool; public sign-up never grants editor.
USER_ID=$(sqlite3 -bail "$DB_PATH" "SELECT id FROM user WHERE email = '$(printf '%s' "$DEV_EMAIL" | sed "s/'/''/g")';")
if [[ -z "$USER_ID" ]]; then
  echo "No provisioned identity found" >&2
  exit 1
fi
sqlite3 -bail "$DB_PATH" "UPDATE user SET role = 'editor' WHERE id = '$(printf '%s' "$USER_ID" | sed "s/'/''/g")';"

SIGNIN_HTTP=$(curl -sS -o "$SEED_DIR/signin.json" -w "%{http_code}" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H "Cookie: csrf-token=$CSRF_TOKEN" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Origin: $BASE_URL" \
  -H "content-type: application/json" \
  -X POST "$BASE_URL/api/auth/sign-in/email" \
  -d "$SIGNIN_PAYLOAD")

if [[ "$SIGNIN_HTTP" != "200" && "$SIGNIN_HTTP" != "201" ]]; then
  printf 'Sign-in failed (HTTP %s): %s\n' "$SIGNIN_HTTP" "$(cat "$SEED_DIR/signin.json" 2>/dev/null || true)"
  exit 1
fi

printf 'Editor authenticated. Cookie jar: %s\n' "$COOKIE_JAR"
printf 'Open %s/board or use: curl -b %s %s/board\n' "$BASE_URL" "$COOKIE_JAR" "$BASE_URL"
