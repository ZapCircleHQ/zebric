# @zbl/runtime

Core runtime engine for Zebric - interprets Blueprint JSON at runtime.

## Overview

The runtime engine is responsible for:

- Loading and validating Blueprint JSON
- Interpreting routes at runtime
- Executing database queries from Blueprint definitions
- Rendering server-side HTML
- Managing authentication and permissions
- Running background workflows
- Loading and managing plugins
- Hot-reloading when Blueprint changes

## Architecture

```
src/
├── engine.ts           # Main Engine class
├── blueprint/          # Blueprint loader & validator
├── interpreter/        # Route/query interpreters
├── renderer/           # HTML renderer (server-side)
├── database/           # Runtime query builder
├── auth/              # Auth runtime
├── workflows/         # Workflow runtime
├── plugins/           # Plugin system
├── hot-reload/        # Hot reload system
└── server/            # HTTP server
```

## Usage

```typescript
import { ZebricEngine } from '@zebric/runtime'

const engine = new ZebricEngine({
  blueprintPath: './blueprint.json',
  port: 3000,
  dev: {
    hotReload: true
  }
})

await engine.start()
```

## Key Features

### Runtime Interpretation

No code generation - everything is interpreted from Blueprint at runtime:

- Routes matched dynamically
- Queries built and executed on-demand
- Permissions evaluated at runtime
- HTML rendered from Blueprint definitions

### Hot Reload

Blueprint changes are detected and applied instantly without server restart.

### Plugin System

Plugins extend functionality without modifying core engine:

- Workflow steps
- UI components
- Integrations
- Middleware

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Test
pnpm test
```
