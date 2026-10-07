# @zebric/runtime-worker

## 0.7.0

### Minor Changes

- adb3f8e: Add portable notifications, bundled Worker plugin initialization and command handlers,
  R2 file serving and private email outboxes, shared Prometheus metrics, and D1 request
  security auditing. Normalize Worker JSON and DateTime values and reject malformed
  Node entity API input consistently. Redact nested JSON secrets from stored audit history. Establish shared SQLite/D1 conformance tests
  and document remaining platform constraints.
- 2ceb83f: Add Cloudflare Workers authentication through Better Auth on D1, mount the
  standard auth UI and API routes, and support file-backed Blueprint templates
  through bundled text imports or preloaded KV values. Inline page templates are
  now compiled as inline content instead of being interpreted as file paths.
  Workers also expose scoped entity CRUD APIs and accurate Agent API/OpenAPI
  discovery backed by Worker secret bindings and Web Crypto key verification.
  Declarative domain commands now use the shared core execution pipeline, while
  eligible database-only transactional workflows compile to atomic D1 batches
  with workflow skill routes, process-local jobs, and idempotent replay.

### Patch Changes

- Updated dependencies [adb3f8e]
- Updated dependencies [2ceb83f]
  - @zebric/runtime-core@0.7.0
  - @zebric/notifications@0.7.0
  - @zebric/runtime-hono@0.7.0

## 0.6.3

### Patch Changes

- Updated dependencies [25fabeb]
  - @zebric/runtime-core@0.6.3
  - @zebric/runtime-hono@0.6.3

## 0.6.2

### Patch Changes

- @zebric/runtime-core@0.6.2
- @zebric/runtime-hono@0.6.2

## 0.6.1

### Patch Changes

- @zebric/runtime-core@0.6.1
- @zebric/runtime-hono@0.6.1

## 0.5.0

### Minor Changes

- b48d68b: Realign runtime package responsibilities around shared core request, access-control, audit, and query contracts. Remove unused and compatibility-only ports, stop platform runtimes from re-exporting the core API, and make Node, Workers, and simulator query behavior conform to the same normalized access rules.

### Patch Changes

- Updated dependencies [b48d68b]
  - @zebric/runtime-core@0.5.0
  - @zebric/runtime-hono@0.5.0

## 0.4.0

### Patch Changes

- 9200a34: Harden Zebric's authorization and webhook security boundaries.
  - Make explicit RBAC denies override allows across all assigned roles, support conditional anonymous rules, reject malformed permission patterns, and make empty or unresolved conditions fail closed.
  - Prevent record data from spoofing `$currentUser.*` conditions and require the trusted system actor identity for system-session bypasses.
  - Evaluate ownership checks against stored records, enforce row and field read access consistently, and reject unknown fields in row-access conditions.
  - Require RBAC-protected manual workflows to be exposed by their submitted page and authorize every entity/action before execution using only the applicable server-loaded record.
  - Authenticate inbound notification webhooks with a configured bearer secret or timestamped HMAC-SHA256 signature, including replay-window enforcement.

- 8b1a1ba: Enforce blueprint access control in the Workers (D1) query executor, which previously ran every `create`, `update`, and `delete` with no authorization at all. `WorkersQueryExecutor` now:
  - enforces role permissions and entity-level `access` rules for reads, searches, creates, updates, and deletes, matching the Node executor;
  - applies row-level filters to collection reads and hides records that fail read access in `findById`;
  - evaluates update and delete access against the stored record so caller-controlled fields cannot forge ownership;
  - strips fields denied by field-level `access.read` from returned records;
  - drops fields the caller may not write per field-level `access.write` rules, with trusted system / workflow sessions bypassing the filter;
  - treats an update whose fields are all unwritable as a no-op returning the current row.

- Updated dependencies [48bcb96]
- Updated dependencies [9aa29c3]
- Updated dependencies [e0da6cd]
- Updated dependencies [9200a34]
- Updated dependencies [1df1c9a]
- Updated dependencies [4baefc7]
  - @zebric/runtime-core@0.4.0
  - @zebric/runtime-hono@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [29339d4]
  - @zebric/runtime-core@0.3.1
  - @zebric/runtime-hono@0.3.1

## 0.3.0

### Minor Changes

- c6cc5a0: Add client-side blueprint widgets, conditional actions and workflow
  preconditions, stronger workflow authorization, and the runtime capabilities
  used by the dog-rescue example.

### Patch Changes

- Updated dependencies [c6cc5a0]
  - @zebric/runtime-core@0.3.0
  - @zebric/runtime-hono@0.3.0

## 0.3.0

### Minor Changes

- Release Zebric 0.3.0 to capture the broader platform work across client-side widgets, benchmarking, diagnostics, playground improvements, and dependency/runtime updates.

### Patch Changes

- Updated dependencies
- Updated dependencies [746e092]
  - @zebric/runtime-core@0.3.0
  - @zebric/runtime-hono@0.3.0

## 0.2.3

### Patch Changes

- cfd46f3: Fix the Zebric engine version reported by the Node runtime so it follows the package version instead of a stale hard-coded value.
- Updated dependencies [cfd46f3]
  - @zebric/runtime-core@0.2.3
  - @zebric/runtime-hono@0.2.3
