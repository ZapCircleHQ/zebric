# @zebric/runtime-core

Platform-agnostic engine core for Zebric. Provides the routing, authentication, validation, query execution, and rendering logic shared across all Zebric runtimes.

## Installation

```bash
npm install @zebric/runtime-core
```

You likely don't need to install this directly — it's a peer dependency of `@zebric/runtime-node` and `@zebric/runtime-worker`.

## What's Inside

- **Blueprint parsing** — loads and validates blueprint.toml/json application definitions
- **Request routing** — maps HTTP requests to blueprint-defined endpoints
- **Auth & sessions** — session management, CSRF protection, access control
- **Query execution** — database-agnostic query port for CRUD operations
- **HTML rendering** — server-side rendering of blueprint-defined UI
- **Port interfaces** — TypeScript interfaces for implementing platform adapters

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
