# @zebric/runtime-node

Node.js runtime adapter for Zebric. Runs Zebric blueprint applications on Node.js with Hono, SQLite or PostgreSQL, Redis caching, and local file storage.

## Installation

```bash
npm install @zebric/runtime-node
```

## Quick Start

```typescript
import { ZebricEngine } from '@zebric/runtime-node'

const engine = new ZebricEngine({
  blueprint: './blueprint.toml',
  port: 3000,
})

await engine.start()
```

Or use the CLI:

```bash
npx zebric dev --blueprint blueprint.toml --port 3000
```

## Features

- SQLite and PostgreSQL database adapters
- Local file storage
- Redis caching
- Session management with CSRF protection
- Hot reload during development
- Plugin support
- OpenAPI spec generation
- Built-in audit logging and metrics
- Durable workflows with database checkpoints, leases, retries, and delays

## Workflows

Node uses SQLite or PostgreSQL to persist workflow submissions, immutable workflow definitions,
step results, retry budgets and backoff, and delay deadlines. On startup, registered workflows
resume pending jobs and reclaim jobs whose execution lease expired. Multiple schedulers sharing
the database fence stale owners; the default lease lasts 60 seconds and recovery polls every
250 milliseconds. The database creates the reserved `__zbl_*` runtime tables automatically.

Completed steps restore their typed results, including Dates, arrays, objects, booleans, and
`undefined`. Nested conditions and loops resume using their saved branch decisions and source
items. Complete template expressions preserve these types in query data, command input, plugin
parameters, and notification parameters. Embedded expressions still produce strings.

`workflow.retries` is the maximum number of attempts per effect (default 3).
`workflow.timeout` limits each effect, or the entire transaction for a transactional workflow
(default 30 seconds). Retries preserve earlier successful checkpoints. Cancellation and timeouts
abort execution and prevent subsequent database writes through the runtime executor. External
services should accept cancellation where possible and provide their own idempotency: an
external request can be repeated if the process dies after the service accepts it but before
its checkpoint commits.

Database query and command effects commit their checkpoint with their writes. Transactional
workflows commit all their database steps, completion audit, and entity trigger intents together.
They support intermediate reads, nested conditions and loops, and declarative commands. External
effects and unrestricted command handlers are rejected during registration for these workflows.
Nontransactional workflows continue to support Node plugins, notifications, email, and services.

Entity trigger intents persist with mutations and recover after commit. Child submissions have
stable IDs, so recovery after a partial fanout or a lost acknowledgement reuses the same jobs.
Workflow outcomes and command audit/event intents are durable; audit append replay uses stable
audit IDs. The existing live event bus delivers recovered command events at least once.

Command APIs and workflow-backed skill actions persist `Idempotency-Key` receipts across
processes and restarts. Authentication, required scopes, and agent attribution are checked before
replay. Changed request input returns `409 IDEMPOTENCY_KEY_REUSE`; failed transactions save no
receipt. Explicit job retries start a new checkpoint generation while retaining successful
command/transaction receipts to avoid repeating committed mutations.

Owned jobs support `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel`, and
`POST /api/jobs/:id/retry`. Polling reads authoritative database state, including jobs submitted
by an earlier process. Unauthorized job IDs return 404; invalid lifecycle transitions return 409.

Programmatic callers can use `await manager.ensurePersisted(job.id)` after `manager.trigger()`
to wait for durable acceptance, and `getDurableJob`, `cancelDurableJob`, and `retryDurableJob`
for authoritative operations. The existing synchronous getters and statistics reflect the local
scheduler cache. `cleanup()` retains keyed submissions and trigger children so their deduplication
survives cleanup; receipts, retained jobs, and delivered event/audit intents require an explicit
application retention policy. Provider-specific session fields are omitted from persisted contexts.

Durability is enabled by default for the Node query executor. `durable: false` opts a manually
constructed `WorkflowManager` into the legacy in-memory queue. Test adapters without runtime
storage also use that queue.

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
