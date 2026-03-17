# @zebric/plugin-sdk

TypeScript SDK for building Zebric plugins. Provides the types and interfaces needed to extend Zebric with custom workflows, components, middleware, and integrations.

## Installation

```bash
npm install @zebric/plugin-sdk
```

## Quick Start

```typescript
import type { Plugin } from '@zebric/plugin-sdk'

export const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  provides: {
    workflows: ['send-welcome-email'],
  },
  requires: {
    db: true,
  },

  async init(engine, config) {
    // Setup logic here
  },

  workflows: {
    'send-welcome-email': async (params, context) => {
      // Workflow implementation
    },
  },
}
```

Register your plugin with the engine:

```typescript
const engine = new ZebricEngine({
  blueprint: './blueprint.toml',
  plugins: [myPlugin],
})
```

## What Plugins Can Provide

- **Workflows** — custom async actions triggered from blueprints
- **Components** — custom UI components for rendering
- **Middleware** — request/response middleware hooks
- **Integrations** — third-party service connectors

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
