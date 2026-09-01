# @zebric/runtime-core

## 0.4.0

### Minor Changes

- 48bcb96: Add the initial Zebric Agent package and typed query filtering for agent-facing skill collection actions.
- 9aa29c3: Add a shared navigation action bar with persistent light, dark, and automatic color modes, signed-in user controls, app-owned notification destinations, and CSRF-safe sign-out.
- 1df1c9a: Give each built-in design system (`modern`, `classic`, `friendly`, `minimal`) its own WCAG AA-contrast dark-mode palette instead of one shared gray override, and fix two contrast bugs uncovered along the way: `modern`/`friendly`'s success and warning colors were below 4.5:1 against white, and primary-colored links/focus rings/button text could become illegible once a design system's primary color no longer matched a light background. Adds two new semantic tokens, `text-on-primary` and `color-primary-text`, so custom design systems can tune button text and link/focus color independently of the button fill color.

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
