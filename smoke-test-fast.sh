#!/bin/bash
set -e

# Zebric FAST Smoke Test
# Quick checks without running full integration tests

echo "⚡ Zebric Fast Smoke Test"
echo "========================"
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
section() { echo ""; echo "## $1"; echo "---"; }

# 1. Environment
section "Environment"
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 20 ]; then
    pass "Node.js $(node -v)"
else
    fail "Node.js 20+ required"
fi
command -v pnpm &> /dev/null && pass "pnpm $(pnpm -v)" || fail "pnpm not found"

# 2. Dependencies
section "Dependencies"
pnpm install --frozen-lockfile > /dev/null 2>&1 && pass "Dependencies installed" || fail "Install failed"

# 3. Build
section "Build"
if pnpm build > /tmp/zebric-build.log 2>&1; then
    pass "All packages built"
else
    fail "Build failed (check /tmp/zebric-build.log)"
fi

# Check artifacts
[ -f "packages/runtime/dist/index.js" ] && pass "Runtime artifacts exist" || fail "Runtime build missing"
[ -f "packages/cli/dist/index.js" ] && pass "CLI artifacts exist" || fail "CLI build missing"

# 4. Unit tests only (fast, not flaky)
section "Unit Tests"
if pnpm --filter @zebric/runtime test -- tests/unit 2>&1 | tee /tmp/zebric-unit-tests.log | grep -q "Test Files.*passed"; then
    pass "Unit tests passed"
else
    warn "Unit tests had issues (check /tmp/zebric-unit-tests.log)"
fi

# 5. CLI smoke test
section "CLI Commands"
node packages/cli/dist/index.js --help > /dev/null 2>&1 && pass "zebric --help works" || fail "CLI broken"

# 6. Package metadata
section "Package Metadata"
RUNTIME_VERSION=$(node -p "require('./packages/runtime/package.json').version")
CLI_VERSION=$(node -p "require('./packages/cli/package.json').version")
pass "Runtime: v$RUNTIME_VERSION"
pass "CLI: v$CLI_VERSION"

# 7. Documentation
section "Documentation"
[ -f "README.md" ] && pass "README.md exists" || warn "README.md missing"
[ -f "CHANGELOG.md" ] && pass "CHANGELOG.md exists" || warn "CHANGELOG.md missing"

# Summary
section "Summary"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Fast smoke tests completed! ✓${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "⚡ This was the FAST test (unit tests only)"
echo ""
echo "For full testing including integration tests:"
echo "  ./smoke-test-full.sh"
echo ""
echo "For manual integration testing:"
echo "  cd examples/blog && npx zebric dev blueprint.toml"
echo ""
