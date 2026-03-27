# @zebric/runtime-hono

Shared Hono HTTP adapter for Zebric runtimes. Bridges the Zebric blueprint engine to Hono's request/response model, used by both `@zebric/runtime-node` and `@zebric/runtime-worker`.

## Installation

```bash
npm install @zebric/runtime-hono
```

You likely don't need to install this directly — it's a dependency of the platform-specific runtimes.

## Usage

```typescript
import { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { Hono } from 'hono'

const adapter = new BlueprintHttpAdapter({
  blueprint,
  queryExecutor,
  sessionManager,
})

const app = new Hono()
app.all('*', (c) => adapter.handle(c.req.raw))
```

Use this when composing Zebric alongside other Hono routes in an existing application.

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
