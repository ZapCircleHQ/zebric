# @zebric/runtime-node

Node.js runtime adapter for Zebric. Runs Zebric blueprint applications on Node.js with support for SQLite, PostgreSQL, S3, Redis, and more.

## Installation

```bash
npm install @zebric/runtime-node
```

## Quick Start

```typescript
import { ZebricEngine } from '@zebric/runtime-node'

const engine = new ZebricEngine({
  blueprint: './blueprint.toml',
  port: 3000,
})

await engine.start()
```

Or use the CLI:

```bash
npx zebric dev --blueprint blueprint.toml --port 3000
```

## Features

- SQLite and PostgreSQL database adapters
- S3-compatible file storage
- Redis caching
- Session management with CSRF protection
- Hot reload during development
- Plugin support
- OpenAPI spec generation
- Built-in audit logging and metrics

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
