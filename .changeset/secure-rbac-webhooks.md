---
"@zebric/runtime-core": patch
"@zebric/runtime-node": patch
"@zebric/runtime-worker": patch
---

Harden Zebric's authorization and webhook security boundaries.

- Make explicit RBAC denies override allows across all assigned roles, support conditional anonymous rules, reject malformed permission patterns, and make empty or unresolved conditions fail closed.
- Prevent record data from spoofing `$currentUser.*` conditions and require the trusted system actor identity for system-session bypasses.
- Evaluate ownership checks against stored records, enforce row and field read access consistently, and reject unknown fields in row-access conditions.
- Require RBAC-protected manual workflows to be exposed by their submitted page and authorize every entity/action before execution using only the applicable server-loaded record.
- Authenticate inbound notification webhooks with a configured bearer secret or timestamped HMAC-SHA256 signature, including replay-window enforcement.
