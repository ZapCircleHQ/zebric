---
"@zebric/runtime-core": minor
"@zebric/runtime-node": minor
"@zebric/runtime-hono": minor
"@zebric/agent": minor
---

Added domain commands: blueprint-defined commands with TypeScript handlers, SQL-safe identifiers, transactions and audit logs, idempotency (failures are not cached; successful responses are kept for 24 hours or 1000 entries), reloadable command state, and command UI including an action bar. Fixed pagination after filtering. The five key examples now use domain commands, and the Zebric Agent package smoke test packs and overrides all unpublished workspace dependencies.
