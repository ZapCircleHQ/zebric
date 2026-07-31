---
'@zebric/runtime-core': minor
---

Give each built-in design system (`modern`, `classic`, `friendly`, `minimal`) its own WCAG AA-contrast dark-mode palette instead of one shared gray override, and fix two contrast bugs uncovered along the way: `modern`/`friendly`'s success and warning colors were below 4.5:1 against white, and primary-colored links/focus rings/button text could become illegible once a design system's primary color no longer matched a light background. Adds two new semantic tokens, `text-on-primary` and `color-primary-text`, so custom design systems can tune button text and link/focus color independently of the button fill color.
