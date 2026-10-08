# Live Mode phase 1 test plan

This branch adds `page.live`, a durable committed-change journal, an authorized
SSE/poll endpoint, and browser projection replacement. The release criterion is
an already-open page converging to committed server state through every supported
mutation path, without replacing unsaved edits or disclosing unauthorized data.

## Required invariants and executable cases

| Risk | Required assertion | Test location |
| --- | --- | --- |
| Configuration changes existing pages | TOML/JSON preserve `live=true`; omitted/false remain static; invalid values and intervals fail parsing | `runtime-core/src/live/live.test.ts`; shared conformance |
| Incomplete dependency discovery | Queries, board entities/columns, forms and lookups contribute deduplicated dependencies; each dependency passes normal read authorization | Core live tests; Hono endpoint tests |
| Lost render-to-subscribe change | Capture the SSR cursor, commit before subscription, then receive invalidation and render the committed value | Shared conformance; real browser E2E holds the actual SSE request |
| Missing mutation source | UI submit, HTTP update, actual MCP `tools/call`, command and transactional workflow all invalidate and update an open browser | Shared conformance, unchanged on SQLite and Miniflare D1; five real-browser E2E cases |
| Deleted rows remain visible | HTTP create/update/delete converge in two open viewers | Real browser E2E; journal create/update/delete pagination in shared conformance |
| Phantom events | Rollback, malformed HTTP writes and protected-field rejections leave the cursor unchanged and data intact; command idempotency replay produces no second event | Shared conformance; rollback workflow then successful update in browser E2E |
| Nested transaction leak | Nested successful mutations persist both events; an outer rollback undoes nested data and journal entries | Shared conformance |
| Cursor skips a relevant change | Unrelated mutation advances cursor without refresh; the next relevant mutation still invalidates; duplicate reconciliation is stable | Shared conformance |
| Broken change event contract | Events have unique stable IDs, ordered cursors, record IDs and valid timestamps; paginated reads equal a complete read; no record payload/audit metadata | Shared conformance |
| Lost reconnect history | Old render cursor works after SQLite reopen; future cursor invalidates after database reset; retention gaps invalidate conservatively; oldest-row boundary does not over-invalidate | Node restart test; core journal tests; shared conformance |
| Invalid protocol input | Reject non-GET methods, external/fragment paths and malformed/unsafe-integer cursors before reconciliation | Hono endpoint tests; core cursor tests |
| Resume uses wrong cursor | `Last-Event-ID` takes precedence over render cursor | Hono endpoint tests |
| Unauthorized subscription | Anonymous/expired sessions and forbidden entities cannot subscribe; page filters, route/query parameters and dependencies go through the normal executor | Shared conformance; Hono endpoint tests |
| Authorization changes on an open stream | Recheck session identity and read permissions before invalidation; send `unavailable` and close on revocation; never send a stale authorized invalidation | Hono endpoint tests; shared SSE conformance; browser session-revocation E2E |
| Data leakage/cache reuse | Notifications contain only type/cursor, omit titles/entities/audit details and use `no-store` with cookie/authorization variation | Shared SSE conformance; Hono endpoint tests |
| Storage failure breaks transport | Sanitized 503 on poll/read failure; SSE interruption allows fallback; cancellation closes a stream | Hono endpoint tests |
| Browser overwrites edits | Dirty forms after blur, failed saves, canceled resets and inline column edits prevent replacement; edits started during fetch/save stay dirty; reset/successful settlement allows pending refresh | Controlled browser tests; real polling E2E with unsaved draft |
| Refresh storm or stale in-flight result | Debounce burst, ignore duplicate cursor, serialize refresh, fetch again after invalidation during a slow response | Controlled browser tests |
| Broken browser state/enhancements | Preserve scroll, focus and text selection; replaced forms/lookups initialize exactly once | Controlled browser tests |
| Browser transport failure | SSE error falls back to polling; absent EventSource uses real polling; dropping real HTTP sockets recovers via poll without losing dirty edits | Controlled browser tests; real polling/disconnect E2E |
| Projection failure | Temporary 503 keeps old DOM and retries; 401/403 stop future refreshes without replacing content | Controlled browser tests |

Paths in this table are relative to `packages/` unless prefixed with `tests/`.
The runtime-independent cases live in `tests/runtime-conformance/contracts.ts`;
both runtime adapters execute the same assertions. Blueprint/session data live in
`tests/runtime-conformance/fixtures.ts` so browser tests can reuse them without
loading Vitest. Its local `package.json` declares ESM for Playwright imports.

## Test boundaries

CI runs core, Hono, Node and Workers tests and the shared runtime contracts in
`.github/workflows/ci.yml`. The browser workflow selects rendering, journeys and
`@live` tests on pull requests, including both live browser files exactly once;
pushes to main run the full browser suite. Both jobs build the agent package needed
by the MCP mutation helper. The browser job installs Chromium, ffmpeg and Linux
system dependencies and uploads reports plus failure screenshots/videos/traces.
Its path filters include shared conformance fixtures, MCP/agent dependencies,
runtime configuration, lockfiles and the Dispatch example used by browser tests.
Worker test prehooks also build `@zebric/agent` and its dependency graph, including
the compiled `@zebric/agent/runtime` export used by the MCP helper. This applies to
smoke, conformance, full and coverage runs; the separate worker smoke CI job does
not inherit compiled files from the build job.

`packages/runtime-node/tests/playwright/live.e2e.spec.ts` runs Chromium against an
ephemeral TCP listener, production Hono route registration, SQLite, command
execution and durable workflow jobs. Browser EventSource, poll requests and SSR
refreshes are real. Each case creates a fresh database/server and closes browser
streams before server/database cleanup. The MCP case uses the SDK client and
server over an in-memory MCP transport; the resulting application mutation goes
over real HTTP with a writer API key. It does not verify MCP network transport.
The UI case submits a rendered form in a second page while the observer stays open.

Session lookup is a fixture returning a controlled user. This verifies live
authorization and revocation, but not Better Auth login, cookie expiry/signatures,
or credential rotation. API-key resolution and CSRF middleware are real. The two
viewers are separate pages in one authenticated browser context, not different
users. Workflow jobs are triggered through the normal manager, not a workflow HTTP
endpoint. The SSR race case delays a request rather than synthesizing its response.

`live.browser.spec.ts` uses real rendered client code with controlled EventSource
and HTTP responses to exercise deterministic editing and request races. Passing
these tests alone does not prove server integration.

Workers tests execute production engine handlers against real Miniflare D1.
They verify both endpoint transports and mutations, but do not drive a browser
against a Workers TCP deployment. They do not establish deployed Cloudflare proxy
buffering, disconnect behavior, or multi-isolate performance.

## Running the suites

From the repository root:

```sh
# Build shared dependencies, then invoke each suite directly.
pnpm --filter @zebric/agent... build
pnpm --filter @zebric/runtime-core exec vitest run src/live
pnpm --filter @zebric/runtime-hono exec vitest run src/live-endpoint.test.ts
pnpm --filter @zebric/runtime-node exec vitest run src/conformance.test.ts src/database/live-restart.test.ts
pnpm --filter @zebric/runtime-worker exec vitest run tests/integration/conformance.test.ts

# Install browser and video dependencies once, then run both live browser suites.
pnpm --filter @zebric/runtime-node exec playwright install chromium ffmpeg
pnpm --filter @zebric/runtime-node test:browser:live

# Use an installed Chrome instead of downloaded Chromium.
PLAYWRIGHT_CHANNEL=chrome pnpm --filter @zebric/runtime-node test:browser:live

# Optional: screenshots/traces without ffmpeg-dependent failure videos.
PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_VIDEO=off pnpm --filter @zebric/runtime-node test:browser:live
```

Use Playwright's bounded web assertions and explicit request gates for races.
Negative browser assertions wait beyond the relevant debounce/retry window; they
must be paired with a positive recovery assertion where recovery is expected.
Keep storage and route-contract failures visible rather than skipping a runtime.
Run the broader core/Hono/Node/Workers suites before merging to catch interactions
with authorization, transactions, rendering and workflows outside Live Mode.

## Follow-up coverage and known findings

Validation on 2026-10-08: the full core, Hono, Node and Workers Vitest suites
passed **1,444 tests**; the Node suite also reported eight existing skipped tests.
The two live Playwright suites passed **28 tests**, including eleven real-server
E2E cases, using installed Chrome with `PLAYWRIGHT_VIDEO=off` because the local
ffmpeg helper could not launch. Shared dependency builds and diff whitespace
validation passed. These results do not include the follow-up cases below.

| Priority | Case still needed | Acceptance check |
| --- | --- | --- |
| High | Deployed Workers browser journey | Every mutation source updates a real browser over SSE and poll; proxy streaming and reconnect work |
| High | Real auth integration | Sign in through Better Auth; expire/revoke session cookie while streaming and polling; no newly protected data appears |
| Medium | SSR setup unavailable | Journal unavailable during first render produces a usable static page; no live script starts; normal authorized SSR data still renders |
| Medium | Retention against actual SQL | Age/prune real SQLite and D1 journal rows; cursors never move backwards; stale viewers converge even if retained rows are unrelated |
| Medium | Concurrent writers and many viewers | Independent processes/isolate-equivalent clients commit interleaved changes; all viewers converge; query load and stream cleanup remain bounded |
| Medium | Browser lifecycle | Background/foreground forces reconciliation; navigation removes streams/timers; BFCache return obtains a current projection |
| Medium | Additional dirty controls | Checkbox, select/multi-select and file selection block replacement; discarded files and reset allow recovery |
| Medium | Browser state across authorization redirect | SSR refresh redirects to login or ceases to provide live metadata; client stops and retains existing content |
| Medium | PostgreSQL | Run the same committed journal, rollback, pagination and restart cases against PostgreSQL storage |

The rejected-write case found that both entity HTTP adapters report protected
field mutations as **500**, despite correctly rejecting the write and preserving
the journal cursor. Node includes internal error details while Workers sanitizes
them. The live test asserts rejection, unchanged data and unchanged cursor without
claiming these error status/payload contracts are correct. Correct HTTP mapping
and error sanitization require a separate regression and fix.

Do not treat the follow-up rows as already covered. Phase 1 has no distributed
pub/sub, record-level invalidation, WebSocket or collaborative-editing requirement.
