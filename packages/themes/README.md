# @zebric/themes

Built-in themes for Zebric. Zazzle design systems are configured in a blueprint
and expose stable semantic CSS custom properties while the renderer's markup and
JavaScript remain independent of the visual design.

## Installation

```bash
npm install @zebric/themes
```

This package is included automatically by `@zebric/runtime-node` and `@zebric/runtime-worker` — you only need to install it directly if you're building a custom renderer or extending the default theme.

## Usage

```typescript
import { defaultTheme } from '@zebric/themes'
```

Zebric ships with `modern` (the default), `classic`, `friendly`, and `minimal`.
Select one in `blueprint.toml`:

```toml
[design_system]
name = "friendly"
```

Create a design by inheriting a built-in, overriding tokens, and adding CSS files:

```toml
[design_system]
name = "acme"
extends = "modern"
css = ["/styles/layout.css", "/styles/components.css"]

[design_system.tokens]
color-primary = "#6366f1"
surface-card = "#ffffff"
radius-small = "8px"
font-family-heading = 'Georgia, "Times New Roman", serif'
font-size-heading-large = "2.25rem"
font-weight-heading = "700"
line-height-body = "1.6"
```

Typography is semantic too. Systems can customize `font-family-body`,
`font-family-heading`, `font-family-mono`, the `font-size-*` scale,
`font-weight-*`, and `line-height-*`. Font files are not fetched automatically;
include any `@font-face` declarations in one of the system's CSS files.

Token keys may also include the full `--zb-` prefix. To start from scratch,
omit `extends`:

```toml
[design_system]
name = "acme-from-scratch"
css = ["/styles/tokens.css", "/styles/components.css"]

[design_system.tokens]
color-primary = "#222222"
surface-default = "#ffffff"
```

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
