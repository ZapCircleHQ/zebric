# @zebric/themes

Built-in themes for Zebric. Provides the default visual styling used by the Zebric HTML renderer.

## Installation

```bash
npm install @zebric/themes
```

This package is included automatically by `@zebric/runtime-node` and `@zebric/runtime-worker` — you only need to install it directly if you're building a custom renderer or extending the default theme.

## Usage

```typescript
import { defaultTheme } from '@zebric/themes'
```

Custom themes can be defined in your `blueprint.toml`:

```toml
[theme]
primary_color = "#6366f1"
font_family = "Inter, sans-serif"
border_radius = "8px"
```

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
