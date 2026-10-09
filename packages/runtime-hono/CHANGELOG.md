# @zebric/runtime-hono

## 0.8.0

### Minor Changes

- c53fff4: Add Phase 1 Live Mode with `live = true` on pages. Both Node and Workers reconcile committed entity changes through durable runtime metadata and authorized SSE or polling. Live pages refresh server-rendered main content with debounce, reconnection, dirty-form protection, state preservation, and form/control re-enhancement.

  Live Mode adds an optional top-level `[live]` Blueprint section. `reauthorize_interval_seconds` (default 30) sets how often an open live stream fully re-checks the session and read permissions; streams also re-check right before sending an invalidation. `change_retention_hours` (default 24, `0` keeps forever) prunes the `_zebric_changes` journal, and cursors older than the retained history trigger a refresh. If Live Mode setup fails for a page request, the page is served without live updates instead of failing.

### Patch Changes

- Updated dependencies [c53fff4]
  - @zebric/runtime-core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [adb3f8e]
- Updated dependencies [2ceb83f]
  - @zebric/runtime-core@0.7.0

## 0.6.3

### Patch Changes

- Updated dependencies [25fabeb]
  - @zebric/runtime-core@0.6.3

## 0.6.2

### Patch Changes

- @zebric/runtime-core@0.6.2

## 0.6.1

### Patch Changes

- @zebric/runtime-core@0.6.1

## 0.5.0

### Minor Changes

- b48d68b: Realign runtime package responsibilities around shared core request, access-control, audit, and query contracts. Remove unused and compatibility-only ports, stop platform runtimes from re-exporting the core API, and make Node, Workers, and simulator query behavior conform to the same normalized access rules.

### Patch Changes

- Updated dependencies [b48d68b]
  - @zebric/runtime-core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [48bcb96]
- Updated dependencies [9aa29c3]
- Updated dependencies [e0da6cd]
- Updated dependencies [9200a34]
- Updated dependencies [1df1c9a]
- Updated dependencies [4baefc7]
  - @zebric/runtime-core@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [29339d4]
  - @zebric/runtime-core@0.3.1

## 0.3.0

### Minor Changes

- c6cc5a0: Add client-side blueprint widgets, conditional actions and workflow
  preconditions, stronger workflow authorization, and the runtime capabilities
  used by the dog-rescue example.

### Patch Changes

- Updated dependencies [c6cc5a0]
  - @zebric/runtime-core@0.3.0

## 0.3.0

### Minor Changes

- Release Zebric 0.3.0 to capture the broader platform work across client-side widgets, benchmarking, diagnostics, playground improvements, and dependency/runtime updates.

### Patch Changes

- Updated dependencies
- Updated dependencies [746e092]
  - @zebric/runtime-core@0.3.0

## 0.2.3

### Patch Changes

- cfd46f3: Fix the Zebric engine version reported by the Node runtime so it follows the package version instead of a stale hard-coded value.
- Updated dependencies [cfd46f3]
  - @zebric/runtime-core@0.2.3
