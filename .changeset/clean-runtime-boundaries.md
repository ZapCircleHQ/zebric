---
'@zebric/runtime-core': minor
'@zebric/runtime-hono': minor
'@zebric/runtime-node': minor
'@zebric/runtime-worker': minor
'@zebric/runtime-simulator': minor
'@zebric/react-simulator': minor
---

Realign runtime package responsibilities around shared core request, access-control, audit, and query contracts. Remove unused and compatibility-only ports, stop platform runtimes from re-exporting the core API, and make Node, Workers, and simulator query behavior conform to the same normalized access rules.
