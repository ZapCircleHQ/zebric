---
"@zebric/runtime-core": patch
"@zebric/runtime-worker": minor
---

Add Cloudflare Workers authentication through Better Auth on D1, mount the
standard auth UI and API routes, and support file-backed Blueprint templates
through bundled text imports or preloaded KV values. Inline page templates are
now compiled as inline content instead of being interpreted as file paths.
Workers also expose scoped entity CRUD APIs and accurate Agent API/OpenAPI
discovery backed by Worker secret bindings and Web Crypto key verification.
Declarative domain commands now use the shared core execution pipeline, while
eligible database-only transactional workflows compile to atomic D1 batches
with workflow skill routes, process-local jobs, and idempotent replay.
