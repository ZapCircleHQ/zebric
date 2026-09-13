# @zebric/runtime-node

## 0.5.0

### Minor Changes

- b48d68b: Realign runtime package responsibilities around shared core request, access-control, audit, and query contracts. Remove unused and compatibility-only ports, stop platform runtimes from re-exporting the core API, and make Node, Workers, and simulator query behavior conform to the same normalized access rules.

### Patch Changes

- Updated dependencies [b48d68b]
  - @zebric/runtime-core@0.5.0
  - @zebric/runtime-hono@0.5.0
  - @zebric/notifications@0.5.0
  - @zebric/observability@0.5.0

## 0.4.0

### Minor Changes

- 48bcb96: Add the initial Zebric Agent package and typed query filtering for agent-facing skill collection actions.

### Patch Changes

- e0da6cd: Add write-protected entity fields and enforce them end to end.
  - The generated OpenAPI `Create` and `Update` request bodies now omit protected fields: the primary key, the runtime-managed timestamps (`id`, `createdAt`, `updatedAt`), and any field the blueprint denies with `access = { write = false }`. Protected fields stay in the read model, so an agent is never offered them and cannot pass them through a schema-validated Agent API or MCP tool call.
  - `QueryExecutor` (runtime-node) now strips fields the caller may not write on both `create` and `update`/`updateWhere`, honouring blueprint field-level `access.write` rules (including the "cannot write what you cannot read" fallback). Trusted system / workflow sessions bypass the filter, matching how they already bypass entity-level access checks. An update whose fields are all stripped is a no-op that returns the current record rather than erroring.

- 9200a34: Harden Zebric's authorization and webhook security boundaries.
  - Make explicit RBAC denies override allows across all assigned roles, support conditional anonymous rules, reject malformed permission patterns, and make empty or unresolved conditions fail closed.
  - Prevent record data from spoofing `$currentUser.*` conditions and require the trusted system actor identity for system-session bypasses.
  - Evaluate ownership checks against stored records, enforce row and field read access consistently, and reject unknown fields in row-access conditions.
  - Require RBAC-protected manual workflows to be exposed by their submitted page and authorize every entity/action before execution using only the applicable server-loaded record.
  - Authenticate inbound notification webhooks with a configured bearer secret or timestamped HMAC-SHA256 signature, including replay-window enforcement.

- Updated dependencies [48bcb96]
- Updated dependencies [9aa29c3]
- Updated dependencies [e0da6cd]
- Updated dependencies [9200a34]
- Updated dependencies [1df1c9a]
- Updated dependencies [4baefc7]
  - @zebric/runtime-core@0.4.0
  - @zebric/notifications@0.4.0
  - @zebric/runtime-hono@0.4.0
  - @zebric/observability@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [29339d4]
  - @zebric/runtime-core@0.3.1
  - @zebric/notifications@0.3.1
  - @zebric/runtime-hono@0.3.1
  - @zebric/observability@0.3.1

## 0.3.0

### Minor Changes

- c6cc5a0: Add client-side blueprint widgets, conditional actions and workflow
  preconditions, stronger workflow authorization, and the runtime capabilities
  used by the dog-rescue example.

### Patch Changes

- Updated dependencies [c6cc5a0]
  - @zebric/notifications@0.3.0
  - @zebric/observability@0.3.0
  - @zebric/runtime-core@0.3.0
  - @zebric/runtime-hono@0.3.0

## 0.3.0

### Minor Changes

- Release Zebric 0.3.0 to capture the broader platform work across client-side widgets, benchmarking, diagnostics, playground improvements, and dependency/runtime updates.

### Patch Changes

- Updated dependencies
- Updated dependencies [746e092]
  - @zebric/notifications@0.3.0
  - @zebric/observability@0.3.0
  - @zebric/runtime-core@0.3.0
  - @zebric/runtime-hono@0.3.0

## 0.2.3

### Patch Changes

- cfd46f3: Fix the Zebric engine version reported by the Node runtime so it follows the package version instead of a stale hard-coded value.
- Updated dependencies [cfd46f3]
  - @zebric/notifications@0.2.3
  - @zebric/observability@0.2.3
  - @zebric/runtime-core@0.2.3
  - @zebric/runtime-hono@0.2.3
