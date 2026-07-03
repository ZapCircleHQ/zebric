# Zebric — Config-Driven Web Apps at Runtime

[![npm version](https://img.shields.io/npm/v/@zebric/cli)](https://www.npmjs.com/package/@zebric/cli)
[![CI](https://github.com/ZapCircleHQ/zebric/actions/workflows/ci.yml/badge.svg)](https://github.com/ZapCircleHQ/zebric/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Zebric is a **config-driven runtime** that reads **Blueprint** files (TOML or JSON) and serves a working web app at runtime. There is no code generation step. Update a blueprint, refresh the page, and keep moving. Zebric is designed to be **LLM-friendly** and **plugin-extensible**.

> TL;DR: Configure your app instead of generating it. Zebric turns a Blueprint into server-rendered pages, forms, routes, data access, and auth.


## What Is Zebric?

Zebric is a runtime engine for building web apps from Blueprint configuration files. Instead of scaffolding an app and then maintaining generated code, you describe your data model, pages, forms, and workflows declaratively, and Zebric interprets that Blueprint at runtime.

It is best suited to internal tools, admin surfaces, CRUD workflows, prototypes, and AI-assisted application development. When you need to go beyond the built-ins, you can extend Zebric with custom behaviors, layouts, plugins, and workflows.

**Key characteristics:**
- **Configuration-driven**: Define entities, routes, and forms in TOML/JSON instead of code
- **Runtime interpretation**: No build step; changes to Blueprint files are reflected immediately
- **Server-side rendering**: Traditional HTML pages with form submissions (not a SPA framework)
- **Database integration**: Automatic schema generation and CRUD operations from entity definitions
- **AI-friendly**: Designed for AI code generators to create and modify applications iteratively

## Start Here

- Documentation: [docs.zebric.dev](https://docs.zebric.dev)
- Playground and examples: [playground.zebric.dev](https://playground.zebric.dev)
- npm package: [@zebric/cli](https://www.npmjs.com/package/@zebric/cli)

## Project Structure

```
zebric/
├── packages/
│   ├── runtime-core/       # Platform-agnostic engine and ports
│   ├── runtime-node/       # Node.js adapter (SQLite/PostgreSQL, Redis, filesystem)
│   ├── runtime-worker/     # Cloudflare Workers adapter (D1, KV, R2)
│   ├── runtime-hono/       # Hono HTTP adapter shared by runtimes
│   ├── runtime-simulator/  # In-memory runtime used by tests and the simulator
│   ├── cli/                # `zebric` command-line tool
│   ├── plugin-sdk/         # Plugin development SDK
│   ├── themes/             # Built-in themes
│   ├── notifications/      # Notification adapters (email, Slack, console)
│   ├── observability/      # Structured logging
│   ├── framework-stories/  # Blueprint-based integration stories
│   ├── react-simulator/    # React-based blueprint simulator
│   ├── playground/         # Interactive browser playground
│   └── docs/               # Public documentation site (Starlight)
├── plugins/                # Built-in plugins
├── examples/               # Example applications (blog, zebric-dispatch, …)
├── starters/               # Starter templates
├── internal/               # Maintainer-only architecture notes
└── tests/                  # Cross-package integration tests
```

## Quick Start

### Using npm

```bash
# Install Zebric CLI globally
npm install -g @zebric/cli

# Or use with npx (no installation needed)
npx @zebric/cli --version

# Create a new directory for your project
mkdir my-app
cd my-app

# Create a blueprint.toml file
# See docs.zebric.dev and playground.zebric.dev for guides and examples

# Run your app
zebric dev blueprint.toml
# Or with npx:
# npx @zebric/cli dev blueprint.toml

# Visit http://localhost:3000
```

### Development from source

```bash
# Clone the repository
git clone https://github.com/ZapCircleHQ/zebric.git
cd zebric

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run an example app
cd examples/blog
npx zebric dev blueprint.toml

# Visit http://localhost:3000
```

For the quickest path to a first app, start with the docs and examples above.

## Technology Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript
- **HTTP Server**: Hono 4.x
- **Database ORM**: Drizzle ORM with SQLite and PostgreSQL
- **Authentication**: Better Auth (Other providers in the future)
- **Background Jobs**: BullMQ (optional)
- **Caching**: Redis (optional)
- **Styling**: Tailwind CSS

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all unit and integration tests across every package
pnpm test

# Run tests for a single package
pnpm --filter @zebric/runtime-core test
pnpm --filter @zebric/runtime-node test

# Watch mode for development
pnpm --filter @zebric/runtime-node test:watch

# Run the Playwright browser suite (see TESTING.md for tag-specific commands)
pnpm --filter @zebric/runtime-node test:browser
```

For detailed testing information, see [TESTING.md](TESTING.md).

## Current Capabilities

### HTTP & Routing
- Dynamic route matching (`/posts/:id`)
- HTTP methods: GET, POST, PUT, DELETE
- Form submission and validation
- Query parameter handling

### Database
- Schema generation from Blueprint entity definitions
- CRUD operations via Drizzle ORM
- SQLite support for development
- Auto-generated REST API endpoints
- Access control rules at the entity and field level

### Authentication & Security
- Email/password authentication via Better Auth
- Session management
- Role-based access control
- CSRF protection
- Security headers (CSP, XSS protection, etc.)

### HTML Rendering
- Server-side HTML generation
- Layout types: list, detail, form, dashboard
- Tailwind CSS for styling
- View Transitions API support

### Developer Tools
- Hot reload when Blueprint files change
- Admin endpoints for debugging
- Request tracing and metrics
- Audit logging

## Current Limitations

Zebric is still evolving. A few practical limitations to keep in mind:

- **Production readiness**: Suitable for exploration and early projects, but not yet broadly battle-tested for production use
- **Database support**: SQLite and PostgreSQL are supported today
- **Client-side interactivity**: Limited JavaScript; primarily server-rendered HTML with form submissions
- **Performance**: The runtime approach trades some raw performance for iteration speed, and performance work is ongoing
- **Ecosystem**: The plugin ecosystem is still early
- **Breaking changes**: Blueprint schema details and APIs may still change as the project matures

## Use Cases

Zebric works well for:
- Rapid prototyping and MVPs
- Internal tools and admin panels
- AI-assisted application generation
- Learning full-stack web development concepts
- CRUD applications with standard patterns

Zebric may not be suitable for:
- Applications requiring complex client-side interactivity
- High-traffic production systems (until more testing is done)
- Projects requiring integrations that are not yet covered by existing plugins or custom behaviors
- Applications with strict performance requirements

## Documentation

- Full documentation: [docs.zebric.dev](https://docs.zebric.dev)
- Interactive examples and playground: [playground.zebric.dev](https://playground.zebric.dev)
- Repository testing guide: [TESTING.md](TESTING.md)
- Release history: [CHANGELOG.md](CHANGELOG.md)

## License

MIT License - Copyright (c) 2026 Biscotti Labs LLC
