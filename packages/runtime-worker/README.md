# @zebric/runtime-worker

Cloudflare Workers runtime adapter for Zebric. Provides platform-specific implementations for running Zebric applications on Cloudflare's edge network.

## Engine Features

- ✅ **Platform-agnostic business logic** - Uses @zebric/runtime-core for routing, auth, validation
- ✅ **Authentication** - Better Auth on D1, the same auth pages/API paths as Node, or an injected provider
- ✅ **Session management** - Better Auth sessions or optional KV-backed custom sessions
- ✅ **D1 database** - Cloudflare D1 SQL database adapter
- ✅ **Shared HTTP routes** - Uses @zebric/runtime-hono for pages, widgets, and lookup search
- ✅ **Entity API** - Node-compatible CRUD paths with API-key roles and scopes
- ✅ **Discovery** - Honest OpenAPI and `/.well-known/zebric-agent.json` metadata
- ✅ **Domain commands** - Declarative commands use the shared policy, validation, and protected-field pipeline
- ✅ **D1 workflows** - Fixed transactional create/update/delete workflows execute as one atomic D1 batch
- ✅ **File-backed templates** - Bundle imported files or preload them from KV
- ✅ **Web security** - Security headers and double-submit CSRF for cookie-authenticated apps
- ❌ **General workflows** - External effects, intermediate results, control flow, and non-transactional workflows require Node

The package also exports `KVCache`, `R2Storage`, `WorkersCSRFProtection`,
`WorkersCookieManager`, `KVTemplateLoader`, `BundledTemplateLoader`, and
`BehaviorRegistry` as low-level adapters. `CACHE_KV` and `FILES` make cache and
storage adapters available from the engine, but request execution does not use
them automatically; the remaining adapters support custom Worker composition.

## Installation

```bash
pnpm add @zebric/runtime-worker
```

## Quick Start

### 1. Configure wrangler.toml

Copy `wrangler.example.toml` to `wrangler.toml` and configure your bindings:

```toml
compatibility_date = "2025-11-09"
compatibility_flags = ["nodejs_compat", "formdata_parser_supports_files"]

[[rules]]
type = "Text"
globs = ["**/*.toml", "**/*.liquid"]
fallthrough = true

[[d1_databases]]
binding = "DB"
database_id = "your-db-id"

[[r2_buckets]]
binding = "FILES"
bucket_name = "your-bucket"
```

### 2. Create Your Worker

```typescript
import { createWorkerHandler } from '@zebric/runtime-worker'
import blueprintToml from './blueprint.toml'

export default createWorkerHandler({
  blueprintContent: blueprintToml,
  blueprintFormat: 'toml',
})
```

`createWorkerHandler` retains one engine per Worker isolate so process-local
workflow jobs and idempotency replays remain observable across requests.

## Authentication

When the Blueprint contains an `[auth]` block, the engine initializes Better
Auth directly against the `DB` D1 binding. It mounts `/api/auth/*`,
`/auth/sign-in`, `/auth/sign-up`, and `/auth/sign-out`, and uses the resulting
session for page and entity authorization.

Set a stable public origin and a high-entropy secret:

```toml
[vars]
BETTER_AUTH_URL = "https://app.example.com"
```

```bash
wrangler secret put BETTER_AUTH_SECRET
```

Better Auth's `user`, `session`, `account`, and `verification` tables must be
included in your D1 migrations before enabling auth. Generate the schema with
the Better Auth CLI for the installed version, then apply it with Wrangler.
Workers auth requires the `nodejs_compat` compatibility flag.

For a custom identity service, pass `authProvider` and optionally
`sessionManager` to `ZebricWorkersEngine`; the provider's standard `handler`
is still mounted at the Node-compatible auth API path.

## File-backed templates

Workers do not have a deployment filesystem like Node. Import template files
as text and pass their contents keyed by the exact Blueprint `source` path:

```typescript
import pageTemplate from './templates/page.html'

const engine = new ZebricWorkersEngine({
  env,
  blueprint,
  templates: {
    'templates/page.html': pageTemplate,
  },
})
```

Wrangler imports `.html` as text by default. The configuration above adds text
module rules for Blueprint `.toml` and template `.liquid` files. Alternatively,
bind a KV namespace as `TEMPLATES_KV`; keys use the `template:` prefix by
default and the engine preloads all file-backed
page, slot, and auth templates before serving a request.

## Remaining Node parity gaps

Workers execute declarative domain commands and transactional workflows that
contain a fixed list of database create/update/delete steps. Eligible workflows
are compiled up front and submitted through one atomic D1 batch. Workflow-backed
Agent API skill routes, manual actions, entity triggers, job observation, and
per-isolate idempotent replay are available for that subset.

Command handlers and workflows with intermediate query results, commands,
external effects, delays, loops, conditions, or non-transactional execution are
rejected or omitted from discovery. Jobs and idempotency entries are process-local,
not durable across isolates: jobs expire after an hour and are capped at 1000 per
isolate, so a retry or poll that lands on another isolate can re-execute or 404.
Node's notification/plugin lifecycle, audit/metrics
stack, event stream, and upload routes also remain Node-only.

## Entity API and API keys

Workers expose the same generic entity paths as Node:

```text
GET    /api/items
POST   /api/items
GET    /api/items/:id
PUT    /api/items/:id
DELETE /api/items/:id
```

API keys declared in `[[auth.apiKeys]]` are read from Worker secret bindings
using `keyEnv`. Keys receive their configured roles, scopes, and constraints;
entity routes require scopes such as `entity.item.list` and
`entity.item.update`. Agent mutations must also include `X-Agent-Run-ID`.
Valid API keys bypass browser CSRF checks, while invalid bearer values do not.

Discovery is available at `/.well-known/zebric-agent.json` and
`/api/openapi.json`. Worker metadata includes supported declarative commands and
D1-batch workflow skills while omitting unsupported handlers and workflow shapes.

## Session Management

### Creating Sessions

```typescript
const sessionManager = new WorkersSessionManager({
  kv: env.SESSIONS,
  sessionTTL: 86400 // 24 hours
})

// Create session
const { sessionId, csrfToken } = await sessionManager.createSession(
  userId,
  userData
)

// Set session cookie
const cookie = sessionManager.createSessionCookie(sessionId)
response.headers.set('Set-Cookie', cookie)
```

`WorkersSessionManager` is the lower-level KV session adapter. It remains useful
for custom auth providers; the engine uses Better Auth sessions by default when
the Blueprint has `[auth]`.

### Getting Sessions

```typescript
// From either a Fetch Request or a normalized HttpRequest
const session = await sessionManager.getSession(request)

// From session ID
const session = await sessionManager.getSessionById(sessionId)
```

### Destroying Sessions

```typescript
await sessionManager.destroySession(sessionId)

// Set logout cookie
const cookie = sessionManager.createLogoutCookie()
response.headers.set('Set-Cookie', cookie)
```

## CSRF Protection

### Automatic Validation

The `WorkersCSRFProtection` class provides automatic CSRF validation:

```typescript
const csrfProtection = new WorkersCSRFProtection({
  sessionManager,
  cookieName: 'csrf-token',
  headerName: 'x-csrf-token',
  formFieldName: '_csrf'
})

// Validate (returns null if valid, error Response if invalid)
const error = await csrfProtection.validateOrReject(request, sessionId)
if (error) return error
```

### Manual Validation

```typescript
// Get token for session
const token = await csrfProtection.getToken(sessionId)

// Validate token
const isValid = await csrfProtection.validate(request, sessionId)
if (!isValid) {
  return new Response('Invalid CSRF token', { status: 403 })
}
```

### Setting CSRF Cookie

```typescript
const token = await csrfProtection.getToken(sessionId)
const response = csrfProtection.addTokenToResponse(originalResponse, token)
```

## Cookie Management

### Parsing Cookies

```typescript
import { WorkersCookieManager } from '@zebric/runtime-worker'

// Parse all cookies
const cookies = WorkersCookieManager.parse(request)

// Get specific cookie
const sessionId = WorkersCookieManager.get(request, 'session')
```

### Setting Cookies

```typescript
// Create session cookie
const cookie = WorkersCookieManager.createSessionCookie('session', sessionId)

// Create persistent cookie (7 days)
const cookie = WorkersCookieManager.createPersistentCookie(
  'remember',
  token,
  604800 // 7 days in seconds
)

// Create custom cookie
const cookie = WorkersCookieManager.serialize('name', 'value', {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 3600
})

// Set on response
response.headers.set('Set-Cookie', cookie)
```

### Deleting Cookies

```typescript
const cookie = WorkersCookieManager.createExpiredCookie('session')
response.headers.set('Set-Cookie', cookie)
```

## Database (D1)

```typescript
import { D1Adapter } from '@zebric/runtime-worker'

const db = new D1Adapter(env.DB)

// Execute raw SQL
const results = await db.raw('SELECT * FROM users WHERE id = ?', [userId])

// Query builder (coming soon)
// const users = await db.query('users').where('active', true).all()
```

## Cache (KV)

```typescript
import { KVCache } from '@zebric/runtime-worker'

const cache = new KVCache(env.CACHE)

// Get cached value
const value = await cache.get('key')

// Set with TTL
await cache.set('key', 'value', 3600)

// Delete
await cache.delete('key')

// KV has no bulk delete; this logs a warning and leaves entries intact
await cache.clear()
```

## Storage (R2)

```typescript
import { R2Storage } from '@zebric/runtime-worker'

const storage = new R2Storage({ bucket: env.FILES })

// Upload file
await storage.store('path/to/file.jpg', buffer, 'image/jpeg')

// Get file
const file = await storage.retrieve('path/to/file.jpg')

// Delete file
await storage.delete('path/to/file.jpg')

// List files
const files = await storage.list('uploads/')
```

## Form Data & File Uploads

Cloudflare Workers has native support for form data parsing:

```typescript
// Parse form data
const formData = await request.formData()
const name = formData.get('name')
const file = formData.get('file') as File

// Access file properties
console.log(file.name, file.size, file.type)

// Read file contents
const buffer = await file.arrayBuffer()
```

## Rate Limiting

Configure rate limiting in `wrangler.toml`:

```toml
[[unsafe.bindings]]
name = "RATE_LIMITER"
type = "ratelimit"
namespace_id = "your-namespace-id"
simple = { limit = 100, period = 60 }
```

Use in your worker:

```typescript
const { success } = await env.RATE_LIMITER.limit({ key: clientIP })
if (!success) {
  return new Response('Rate limit exceeded', { status: 429 })
}
```

## Architecture

The runtime-worker package follows a clean architecture:

```
┌─────────────────────────────────────────┐
│     Cloudflare Workers fetch API        │
│            (Request/Response)           │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│         WorkersAdapter                  │
│   (Platform-specific HTTP handling)     │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│     @zebric/runtime-core                │
│      RequestHandler                     │
│   (Platform-agnostic business logic)    │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│        Platform Adapters                │
│  D1Adapter | KVCache | R2Storage        │
│  SessionManager | CSRFProtection        │
└─────────────────────────────────────────┘
```

Shared orchestration, access control, validation, rendering, and port contracts live
in `@zebric/runtime-core`. D1 query compilation and Cloudflare service integration
remain in this package; HTTP translation and shared routes live in
`@zebric/runtime-hono`.

## Security Best Practices

1. **Always use HTTPS** - Set `secure: true` on all cookies
2. **Enable CSRF protection** - Use `WorkersCSRFProtection` for all mutating requests
3. **HttpOnly cookies** - Keep session cookies httpOnly to prevent XSS
4. **SameSite strict** - Use `sameSite: 'strict'` for session cookies
5. **Session TTL** - Set reasonable session expiration times
6. **Rate limiting** - Configure rate limits to prevent abuse

## Examples

See `/examples` directory for complete examples:

- Basic worker with sessions
- File upload handler
- API with CSRF protection
- Multi-tenant application

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Local development
pnpm wrangler dev

# Deploy
pnpm wrangler deploy
```

## License

MIT

## Operational notes

- `BETTER_AUTH_SECRET` is required unless the auth base URL is `localhost`.
- Entities may not map to reserved API paths (`/api/jobs`, `/api/commands`,
  `/api/auth`); the engine throws at startup if one does.
- CSRF checks apply whenever a request carries a session. Valid API-key bearer
  requests are exempt.
- Discovery endpoints send open CORS headers only for Blueprints without `[auth]`.
- A Blueprint with no `[auth]` permissions or entity access rules leaves the entity
  CRUD API open to anonymous callers, matching core access-control defaults.
