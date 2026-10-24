---
"@zebric/runtime-core": minor
"@zebric/runtime-node": patch
"@zebric/runtime-worker": patch
"@zebric/runtime-simulator": patch
---

Resolve policy relations from stored records instead of trusting embedded request objects. Add immutable fields to prevent ownership and parent references from being reassigned after creation across Node, Workers, and simulator writes.

Ridgeline now authorizes customer accounts and their children through admin-provisioned user-ID memberships instead of email snapshots, including server-side account lookup during creation and adversarial ownership regression coverage.
