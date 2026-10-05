---
"@zebric/runtime-core": patch
"@zebric/runtime-worker": minor
---

Add Cloudflare Workers authentication through Better Auth on D1, mount the
standard auth UI and API routes, and support file-backed Blueprint templates
through bundled text imports or preloaded KV values. Inline page templates are
now compiled as inline content instead of being interpreted as file paths.
