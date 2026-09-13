# @zebric/runtime-core

Platform-agnostic application core for Zebric. It owns blueprint parsing, request orchestration, access rules, rendering, and the contracts implemented by platform runtimes.

## Installation

```bash
npm install @zebric/runtime-core
```

You likely don't need to install this directly — it's a peer dependency of `@zebric/runtime-node` and `@zebric/runtime-worker`.

## What's Inside

- **Blueprint parsing** — loads and validates blueprint.toml/json application definitions
- **Request routing** — maps HTTP requests to blueprint-defined endpoints
- **Auth & session contracts** — shared session types, auth interfaces, and access control
- **Query contracts** — database-agnostic ports implemented by platform runtimes
- **Behavior contracts** — shared behavior context and pure helper functions
- **HTML rendering** — server-side rendering of blueprint-defined UI
- **Port interfaces** — TypeScript interfaces for implementing platform adapters

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
