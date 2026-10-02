---
"@zebric/runtime-node": patch
---

Do not initialize Better Auth when a Blueprint has no `[auth]` configuration. Public applications now use a `DisabledAuthProvider` that returns no session, so Better Auth's database tables are no longer required.
