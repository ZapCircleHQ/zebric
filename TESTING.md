# Testing Strategy

## Test Organization

Tests are organized into two main categories:

### Unit Tests (`tests/unit/`)
Fast, isolated tests that don't require external dependencies.

**Run unit tests:**
```bash
pnpm --filter @zebric/runtime test:unit
```

**Characteristics:**
- ✅ Fast (< 1 second)
- ✅ Reliable (no flakiness)
- ✅ No external dependencies
- ✅ Run in CI on every commit

**Examples:**
- Blueprint parsing
- Schema diffing
- Input validation
- Access control rule evaluation
- Security utilities

### Integration Tests (`tests/integration/`)
Full end-to-end tests that spin up servers and databases.

**Run integration tests:**
```bash
pnpm --filter @zebric/runtime test:integration
```

**Characteristics:**
- ⚠️ Slower (2-5 minutes)
- ⚠️ Can be flaky (timing, ports, DB cleanup)
- ⚠️ Require full environment
- ⚠️ Run in CI but failures may be acceptable

**Examples:**
- CRUD operations
- Authentication flows
- Authorization checks
- Error handling
- Field-level access control

## Running Tests

### Quick Check (30 seconds)
```bash
./smoke-test-fast.sh
```
Runs unit tests only. Use this for rapid feedback during development.

### Full Check (3-5 minutes)
```bash
./smoke-test-full.sh
```
Runs all tests including integration. Use before final release.

### Specific Test Suites
```bash
# All tests
pnpm --filter @zebric/runtime test

# Unit tests only
pnpm --filter @zebric/runtime test:unit

# Integration tests only
pnpm --filter @zebric/runtime test:integration

# Watch mode (for development)
pnpm --filter @zebric/runtime test:watch

# Coverage report
pnpm --filter @zebric/runtime test:coverage

# Interactive UI
pnpm --filter @zebric/runtime test:ui
```

## CI/CD Strategy

### GitHub Actions

**On every push/PR:**
1. ✅ Build all packages
2. ✅ Run unit tests (must pass)
3. ⚠️ Run integration tests (failures logged but don't block)

**Before release:**
1. ✅ All unit tests must pass
2. ⚠️ Integration tests should pass (manual verification if flaky)
3. ✅ Manual testing of example apps

## Manual Testing

Integration tests can be flaky, so **manual testing is recommended** before release:

### Blog Example
```bash
cd examples/blog
npx zebric dev blueprint.toml
# Visit http://localhost:3000
# - Create a post
# - Edit a post
# - Delete a post
# - Verify hot reload works
```

### Task Tracker
```bash
cd examples/task-tracker
npx zebric dev blueprint.toml
# Visit http://localhost:3000
# - Sign up
# - Sign in
# - Create tasks
# - Update tasks
# - Delete tasks
# - Sign out
```

### Custom Theme
```bash
cd examples/custom-theme
npx zebric dev blueprint.toml
# Visit http://localhost:3000
# - Verify custom purple/pink theme loads
# - Check styling is applied
```

## Handling Flaky Tests

If integration tests fail:

1. **Check the failure reason**
   - Port already in use? → Other process running
   - Timeout? → System under load
   - Database locked? → Cleanup issue

2. **Re-run the specific test**
   ```bash
   pnpm --filter @zebric/runtime test:integration -- authorization.spec.ts
   ```

3. **If it passes on retry** → Flaky test (acceptable for integration)

4. **If it consistently fails** → Real issue, must be fixed

## Writing New Tests

### Unit Tests
```typescript
import { describe, it, expect } from 'vitest'

describe('MyFeature', () => {
  it('should do something', () => {
    const result = myFunction()
    expect(result).toBe(expected)
  })
})
```
✅ Fast, isolated, no external dependencies

### Integration Tests
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestHarness } from '../helpers'

describe('MyFeature Integration', () => {
  const harness = createTestHarness()
  let engine: any

  beforeEach(async () => {
    await harness.createTempDir()
    // Setup engine, database, etc.
  })

  afterEach(async () => {
    if (engine) await engine.stop()
    await harness.cleanup()
  })

  it('should work end-to-end', async () => {
    // Test with real HTTP requests
  })
})
```
⚠️ Use sparingly, clean up properly

## Pre-Release Checklist

Before releasing:

- [ ] `./smoke-test-fast.sh` passes (unit tests)
- [ ] Manual test of each example app
- [ ] `./smoke-test-full.sh` passes (or investigate failures)
- [ ] No regressions in core functionality
- [ ] Breaking changes documented in CHANGELOG.md

## Test Coverage

Current coverage (approximate):

- **Unit tests:** High coverage on core logic
- **Integration tests:** Covers main user flows
- **Manual tests:** Required for release confidence

Goal: Maintain >80% unit test coverage, with integration tests covering critical paths.
