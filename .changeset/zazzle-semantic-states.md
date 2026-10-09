---
"@zebric/runtime-core": patch
"@zebric/themes": patch
---

Extend Zazzle semantic styling to generated detail fields, related feeds,
checklists, timelines, boards, action bars, command controls, and footers.
Status badges, feedback, and destructive actions now use design tokens rather
than fixed Tailwind colors. Add color-error and color-info to each built-in light
and dark palette, and apply semantic styles to error, empty, and loading states.
Document the blueprint design-system configuration and custom state colors.
Load custom design-system stylesheets after built-in styles so their overrides
take effect, preserving their declaration order.
