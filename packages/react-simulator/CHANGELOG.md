# @zebric/react-simulator

## 0.5.0

### Minor Changes

- b48d68b: Realign runtime package responsibilities around shared core request, access-control, audit, and query contracts. Remove unused and compatibility-only ports, stop platform runtimes from re-exporting the core API, and make Node, Workers, and simulator query behavior conform to the same normalized access rules.

### Patch Changes

- Updated dependencies [b48d68b]
  - @zebric/runtime-core@0.5.0
  - @zebric/runtime-simulator@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [48bcb96]
- Updated dependencies [9aa29c3]
- Updated dependencies [e0da6cd]
- Updated dependencies [9200a34]
- Updated dependencies [1df1c9a]
- Updated dependencies [4baefc7]
  - @zebric/runtime-core@0.4.0
  - @zebric/runtime-simulator@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [29339d4]
  - @zebric/runtime-core@0.3.1
  - @zebric/runtime-simulator@0.3.1

## 0.3.0

### Minor Changes

- c6cc5a0: Add client-side blueprint widgets, conditional actions and workflow
  preconditions, stronger workflow authorization, and the runtime capabilities
  used by the dog-rescue example.

### Patch Changes

- Updated dependencies [c6cc5a0]
  - @zebric/runtime-simulator@0.3.0
  - @zebric/runtime-core@0.3.0

## 0.0.1

### Patch Changes

- 746e092: Add the browser-only Zebric simulator runtime and React simulator UI polish, including in-memory seeds, simulated auth, client-side rendering, audit events, integration outbox support, and inbound webhook simulation. Runtime core now uses `smol-toml` for blueprint parsing consistency.
- Updated dependencies
- Updated dependencies [746e092]
  - @zebric/runtime-core@0.3.0
  - @zebric/runtime-simulator@0.0.1
