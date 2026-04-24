#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

curl -sS -c "$COOKIE_JAR" "$BASE/" > /dev/null
CSRF="$(grep csrf-token "$COOKIE_JAR" | awk '{print $NF}')"

post_json() {
  curl -sS -X POST "$BASE$1" \
    -b "$COOKIE_JAR" \
    -H "x-csrf-token: $CSRF" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$2"
}

echo "Creating customers..."
post_json /api/customers '{"firstName":"Sarah","lastName":"Chen","email":"sarah@acme.com","company":"Acme Corp"}' >/dev/null
post_json /api/customers '{"firstName":"Miguel","lastName":"Rodriguez","email":"miguel@globex.com","company":"Globex"}' >/dev/null
post_json /api/customers '{"firstName":"Priya","lastName":"Patel","email":"priya@initech.com","company":"Initech"}' >/dev/null
post_json /api/customers '{"firstName":"James","lastName":"Smith","email":"j.smith@acme.com","company":"Acme Corp"}' >/dev/null
post_json /api/customers '{"firstName":"Mei","lastName":"Smith","email":"mei.smith@globex.com","company":"Globex"}' >/dev/null
post_json /api/customers '{"firstName":"Anya","lastName":"Volkov","email":"anya@umbrella.io","company":"Umbrella"}' >/dev/null
post_json /api/customers '{"firstName":"David","lastName":"Okonkwo","email":"david@hooli.com","company":"Hooli"}' >/dev/null
post_json /api/customers '{"firstName":"Lena","lastName":"Müller","email":"lena@piedpiper.com","company":"Pied Piper"}' >/dev/null

echo "Done. Try:"
echo "  $BASE/orders/new   — lookup as a form field"
echo "  $BASE/search       — lookup as a standalone widget"
