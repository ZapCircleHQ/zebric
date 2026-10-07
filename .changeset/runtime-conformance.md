---
"@zebric/runtime-core": minor
"@zebric/runtime-node": patch
"@zebric/runtime-worker": minor
"@zebric/notifications": minor
---

Add portable notifications, bundled Worker plugin initialization and command handlers,
R2 file serving and private email outboxes, shared Prometheus metrics, and D1 request
security auditing. Normalize Worker JSON and DateTime values and reject malformed
Node entity API input consistently. Redact nested JSON secrets from stored audit history. Establish shared SQLite/D1 conformance tests
and document remaining platform constraints.
