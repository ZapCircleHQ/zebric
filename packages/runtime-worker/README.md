# @zebric/runtime-worker

CloudFlare Workers runtime adapter for Zebric. Provides platform-specific implementations for running Zebric applications on CloudFlare's edge network.

## Features

- ✅ **Platform-agnostic business logic** - Uses @zebric/runtime-core for routing, auth, validation
- ✅ **Session management** - KV-backed sessions with automatic expiration
- ✅ **CSRF protection** - Token-based CSRF validation
- ✅ **Cookie management** - Secure cookie parsing and serialization
- ✅ **Form data parsing** - Native support for forms and file uploads
- ✅ **D1 database** - CloudFlare D1 SQL database adapter
- ✅ **KV cache** - CloudFlare KV storage for caching
- ✅ **R2 storage** - CloudFlare R2 object storage for files
- ✅ **Rate limiting** - Native Workers rate limiting (when configured)

## Installation

```bash
pnpm add @zebric/runtime-worker
```

## Quick Start

### 1. Configure wrangler.toml

Copy `wrangler.example.toml` to `wrangler.toml` and configure your bindings:

```toml
compatibility_date = "2025-11-09"
compatibility_flags = ["formdata_parser_supports_files"]
node_compat = true

[[kv_namespaces]]
binding = "SESSIONS"
id = "your-kv-id"

[[d1_databases]]
binding = "DB"
database_id = "your-db-id"

[[r2_buckets]]
binding = "FILES"
bucket_name = "your-bucket"
```

### 2. Create Your Worker

```typescript
import { Hono } from 'hono'
import { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import {
  WorkersSessionManager,
  WorkersQueryExecutor,
  D1Adapter
} from '@zebric/runtime-worker'
import { blueprint } from './blueprint'

export interface Env {
  SESSIONS: KVNamespace
  DB: D1Database
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const db = new D1Adapter(env.DB)
    const queryExecutor = new WorkersQueryExecutor(db, blueprint)
    const sessionManager = new WorkersSessionManager({
      kv: env.SESSIONS
    })

    const adapter = new BlueprintHttpAdapter({
      blueprint,
      queryExecutor,
      sessionManager
    })

    const app = new Hono()
    app.get('/health', async () => new Response(JSON.stringify({ status: 'healthy' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    app.all('*', (c) => adapter.handle(c.req.raw))

    return app.fetch(request, env, ctx)
  }
}
```

> `ZebricWorkersEngine` and `createWorkerHandler` now use this same Hono-based adapter internally. If you already have other Hono routes, you can compose Zebric by mounting the adapter in your existing `app`.

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

### Getting Sessions

```typescript
// From HttpRequest (in RequestHandler)
const session = await sessionManager.getSession(httpRequest)

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
await cache.set('key', 'value', { ttl: 3600 })

// Delete
await cache.delete('key')

// Clear all
await cache.clear()
```

## Storage (R2)

```typescript
import { R2Storage } from '@zebric/runtime-worker'

const storage = new R2Storage(env.FILES)

// Upload file
await storage.put('path/to/file.jpg', buffer, {
  contentType: 'image/jpeg'
})

// Get file
const file = await storage.get('path/to/file.jpg')

// Delete file
await storage.delete('path/to/file.jpg')

// List files
const files = await storage.list({ prefix: 'uploads/' })
```

## Form Data & File Uploads

CloudFlare Workers has native support for form data parsing:

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
│     CloudFlare Workers fetch API        │
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

All business logic (routing, auth, validation, query execution) lives in `@zebric/runtime-core` and is shared across all platforms (Node, Workers, etc.).

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
