---
"@zebric/runtime-core": minor
"@zebric/runtime-hono": minor
"@zebric/runtime-node": minor
"@zebric/runtime-worker": minor
---

Add Phase 1 Live Mode with `live = true` on pages. Both Node and Workers reconcile committed entity changes through durable runtime metadata and authorized SSE or polling. Live pages refresh server-rendered main content with debounce, reconnection, dirty-form protection, state preservation, and form/control re-enhancement.

Live Mode adds an optional top-level `[live]` Blueprint section. `reauthorize_interval_seconds` (default 30) sets how often an open live stream fully re-checks the session and read permissions; streams also re-check right before sending an invalidation. `change_retention_hours` (default 24, `0` keeps forever) prunes the `_zebric_changes` journal, and cursors older than the retained history trigger a refresh. If Live Mode setup fails for a page request, the page is served without live updates instead of failing.
