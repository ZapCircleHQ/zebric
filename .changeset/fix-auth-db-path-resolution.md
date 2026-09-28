---
"@zebric/runtime-node": patch
---

Fixed Better Auth connecting to the wrong SQLite file when a custom `databaseUrl` is passed to `createZebric()` outside dev mode. Previously, auth silently fell back to `./data/app.db` instead of the configured database, causing "no such table: user" errors on sign-up/sign-in. Auth now resolves the same database file as the rest of the engine.
