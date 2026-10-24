# @zebric/themes

## 0.10.0

No changes in this release.

## 0.9.0

### Patch Changes

- 1fe47d5: Extend Zazzle semantic styling to generated detail fields, related feeds,
  checklists, timelines, boards, action bars, command controls, and footers.
  Status badges, feedback, and destructive actions now use design tokens rather
  than fixed Tailwind colors. Add color-error and color-info to each built-in light
  and dark palette, and apply semantic styles to error, empty, and loading states.
  Document the blueprint design-system configuration and custom state colors.
  Load custom design-system stylesheets after built-in styles so their overrides
  take effect, preserving their declaration order.

## 0.8.0

## 0.7.0

## 0.6.3

## 0.6.2

## 0.6.1

## 0.5.0

## 0.4.0

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

## 0.2.3

### Patch Changes

- cfd46f3: Fix the Zebric engine version reported by the Node runtime so it follows the package version instead of a stale hard-coded value.
