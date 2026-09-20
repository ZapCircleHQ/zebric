# @zebric/runtime-hono

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
