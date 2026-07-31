# @zebric/runtime-core

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
