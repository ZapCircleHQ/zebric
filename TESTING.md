# Testing Strategy

Zebric uses a four-layer test pyramid. Each layer has a different cost and purpose; only run what you need for your current task.

---

## Layers

### 1. Unit tests — Vitest
Fast, isolated, no server or browser. Run on every PR and on every push to `main`.

**Packages with unit tests:**
`runtime-core`, `runtime-node`, `runtime-worker`, `runtime-hono`, `runtime-simulator`,
`observability`, `notifications`, `react-simulator`, `framework-stories`, `cli`

```bash
# All packages at once
pnpm test

# One package
pnpm --filter @zebric/runtime-core test

# Watch mode during development
pnpm --filter @zebric/runtime-node test:watch
```

### 2. Integration tests — Vitest (runtime-node only)
Spin up a real SQLite-backed engine in-process and exercise HTTP routes. Included in the normal `pnpm test` run; no separate command needed.

These live alongside unit tests in `packages/runtime-node/src/**/*.test.ts` and `tests/integration/`.

### 3. Browser tests — Playwright (Chromium)
Start a real engine against the `zebric-dispatch` example blueprint, then drive it with a headless browser. Run automatically on every push to `main` via `browser-tests.yml`.

Tests are tagged so you can run a subset:

| Tag | Command | What it checks |
|---|---|---|
| `@accessibility` | `test:browser:accessibility` | axe-core WCAG 2.0/2.1 A/AA |
| `@rendering` | `test:browser:rendering` | Zazzle UX attributes, layout primitives |
| `@journey` | `test:browser:journeys` | End-to-end user flows (create, navigate) |
| `@performance` | `test:browser:performance` | Page load under 2 s smoke threshold |

```bash
# Full browser suite (requires a prior build)
pnpm --filter @zebric/runtime-node pretest:browser   # build deps
pnpm --filter @zebric/runtime-node test:browser:install  # one-time Chromium install
pnpm --filter @zebric/runtime-node test:browser

# Single tag
pnpm --filter @zebric/runtime-node test:browser:accessibility
pnpm --filter @zebric/runtime-node test:browser:journeys
```

Fixtures live in `packages/runtime-node/tests/playwright/fixtures/zebric-fixtures.ts`.
Helper contracts live in `packages/runtime-node/tests/playwright/helpers/`.

### 4. Agent browser tests — AI-driven (opt-in only)
Uses an AI agent to verify rendering via natural-language instructions. Never runs in CI.

```bash
OPENAI_API_KEY=sk-... RUN_AGENT_BROWSER_E2E=1 \
  pnpm --filter @zebric/runtime-node test:agent-browser
```

---

## CI overview

| Workflow | Trigger | What runs |
|---|---|---|
| `ci.yml` — Tests | every PR + push to `main`/`develop` | vitest (all packages), coverage upload |
| `ci.yml` — Quality | every PR + push | tsc, eslint |
| `ci.yml` — Blueprint smoke | every PR + push | `zebric validate` on example blueprints |
| `ci.yml` — Worker smoke | every PR + push | runtime-worker integration smoke suite |
| `browser-tests.yml` | push to `main` only | Playwright (all tags) |
| `release.yml` | push to `main` | changesets publish |

---

## Coverage

Coverage is generated for: `runtime-core`, `runtime-node`, `runtime-worker`, `cli`, `notifications`.
Reports are uploaded to Codecov on every CI run.

```bash
# Generate locally
pnpm --filter @zebric/runtime-core test:coverage
pnpm --filter @zebric/runtime-node test:coverage
pnpm --filter @zebric/runtime-worker test:coverage
pnpm --filter @zebric/cli test:coverage
pnpm --filter @zebric/notifications test:coverage
```

---

## Writing new tests

### Unit / integration test
Add a `*.test.ts` file next to the source file. Use vitest. No external services.

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('MyFeature', () => {
  it('does the thing', () => {
    expect(myFunction()).toBe(expected)
  })
})
```

### Browser test
Add a `*.spec.ts` file in `packages/runtime-node/tests/playwright/`. Tag each test with
one of the existing tags. Use the `app` fixture — it starts and stops the engine for you.

```typescript
import { test, expect } from './fixtures/zebric-fixtures.js'
import { expectRenderablePage } from './helpers/page-contracts.js'

test('@rendering my new page renders without errors', async ({ page, app }) => {
  await page.goto(`${app.baseURL}/my-page`)
  await expectRenderablePage(page)
})
```

---

## Pre-release checklist

- [ ] `pnpm test` passes (all packages)
- [ ] `pnpm --filter @zebric/runtime-node test:browser` passes locally
- [ ] No regressions in example apps (manual spot-check)
- [ ] Breaking changes in `CHANGELOG.md`
