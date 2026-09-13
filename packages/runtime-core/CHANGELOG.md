# @zebric/runtime-core

## 0.5.0

### Minor Changes

- b48d68b: Realign runtime package responsibilities around shared core request, access-control, audit, and query contracts. Remove unused and compatibility-only ports, stop platform runtimes from re-exporting the core API, and make Node, Workers, and simulator query behavior conform to the same normalized access rules.

## 0.4.0

### Minor Changes

- 48bcb96: Add the initial Zebric Agent package and typed query filtering for agent-facing skill collection actions.
- 9aa29c3: Add a shared navigation action bar with persistent light, dark, and automatic color modes, signed-in user controls, app-owned notification destinations, and CSRF-safe sign-out.
- 1df1c9a: Give each built-in design system (`modern`, `classic`, `friendly`, `minimal`) its own WCAG AA-contrast dark-mode palette instead of one shared gray override, and fix two contrast bugs uncovered along the way: `modern`/`friendly`'s success and warning colors were below 4.5:1 against white, and primary-colored links/focus rings/button text could become illegible once a design system's primary color no longer matched a light background. Adds two new semantic tokens, `text-on-primary` and `color-primary-text`, so custom design systems can tune button text and link/focus color independently of the button fill color.
- 4baefc7: Derive complete create and update tool inputs from explicitly published entity actions, resolve safe local OpenAPI component schemas, and expand the flagship Task Tracker MCP lifecycle.

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

## 0.3.1

### Patch Changes

- 29339d4: Add Zazzle CSS-only design systems with four built-in styles, semantic color,
  surface, spacing, radius, and typography tokens, blueprint inheritance and CSS
  extensions, and renderer integration. Preserve business values that resemble
  technical identifiers and correct double-escaping in checklist, timeline, and
  activity labels.

## 0.3.0

### Minor Changes

- c6cc5a0: Add client-side blueprint widgets, conditional actions and workflow
  preconditions, stronger workflow authorization, and the runtime capabilities
  used by the dog-rescue example.

## 0.3.0

### Minor Changes

- Release Zebric 0.3.0 to capture the broader platform work across client-side widgets, benchmarking, diagnostics, playground improvements, and dependency/runtime updates.

### Patch Changes

- 746e092: Add the browser-only Zebric simulator runtime and React simulator UI polish, including in-memory seeds, simulated auth, client-side rendering, audit events, integration outbox support, and inbound webhook simulation. Runtime core now uses `smol-toml` for blueprint parsing consistency.

## 0.2.3

### Patch Changes

- cfd46f3: Fix the Zebric engine version reported by the Node runtime so it follows the package version instead of a stale hard-coded value.
