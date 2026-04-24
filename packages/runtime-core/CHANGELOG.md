# @zebric/runtime-core

## 0.3.0

### Minor Changes

- Release Zebric 0.3.0 to capture the broader platform work across client-side widgets, benchmarking, diagnostics, playground improvements, and dependency/runtime updates.

### Patch Changes

- 746e092: Add the browser-only Zebric simulator runtime and React simulator UI polish, including in-memory seeds, simulated auth, client-side rendering, audit events, integration outbox support, and inbound webhook simulation. Runtime core now uses `smol-toml` for blueprint parsing consistency.

## 0.2.3

### Patch Changes

- cfd46f3: Fix the Zebric engine version reported by the Node runtime so it follows the package version instead of a stale hard-coded value.
