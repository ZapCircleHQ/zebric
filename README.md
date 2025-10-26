# Zebric — Declarative Web App Framework (Runtime, not code generation)

[![npm version](https://img.shields.io/npm/v/@zebric/cli)](https://www.npmjs.com/package/@zebric/cli)
[![CI](https://github.com/ZapCircleHQ/zebric/actions/workflows/ci.yml/badge.svg)](https://github.com/ZapCircleHQ/zebric/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Zebric is a **config-driven runtime** that reads **Blueprint** files (TOML/JSON) and serves a **working web app at runtime** — no code generation step. Update a blueprint, refresh the page, done. Designed to be **LLM-friendly** and **plugin-extensible**.

> TL;DR: “Configure your app, don’t generate it.” Server Side Rendered HTML, forms, routes, database, and auth from your Blueprint.


## What is Zebric?

Zebric is a runtime engine that reads Blueprint configuration files (TOML or JSON) and generates working web applications. Instead of writing traditional code, you define your application's data model, pages, and forms declaratively, and Zebric interprets these at runtime to serve a complete web application.

Think of it as a web application framework that you configure, as opposed to a web application framework that you generate code for. You can supply custom behaviors, layouts, plugins or workflows for full extensibility.

**Key characteristics:**
- **Configuration-driven**: Define entities, routes, and forms in TOML/JSON instead of code
- **Runtime interpretation**: No build step; changes to Blueprint files are reflected immediately
- **Server-side rendering**: Traditional HTML pages with form submissions (not a SPA framework)
- **Database integration**: Automatic schema generation and CRUD operations from entity definitions
- **AI-friendly**: Designed for AI code generators to create and modify applications iteratively

## Project Structure

```
zebric/
├── packages/
│   ├── runtime/        # Core runtime engine
│   ├── cli/           # Command-line tools
│   ├── plugin-sdk/    # Plugin development SDK
│   └── themes/        # Built-in themes
├── docs/              # Docs
├── plugins/           # Built-in plugins
├── examples/          # Example applications
│   └── blog/         # Simple blog example
└── tests/            # Test suites

```

## Quick Start

### Using npm (Recommended for users)

```bash
# Install Zebric CLI globally
npm install -g @zebric/cli

# Or use with npx (no installation needed)
npx @zebric/cli --version

# Create a new directory for your project
mkdir my-app
cd my-app

# Create a simple blueprint.toml file (or use an AI tool to generate one)
# See docs/quickstart.md for examples

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

# Run the blog example
cd examples/blog
npx zebric dev blueprint.toml

# Visit http://localhost:3000
```

## Technology Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **HTTP Server**: Fastify 5.x
- **Database ORM**: Drizzle ORM with SQLite and PostgreSQL
- **Authentication**: Better Auth (Other providers in the future)
- **Background Jobs**: BullMQ (optional)
- **Caching**: Redis (optional)
- **Styling**: Tailwind CSS (loaded via CDN)

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (unit tests - fast and reliable)
pnpm --filter @zebric/runtime test:unit

# Run all tests (includes integration tests - may be flaky)
pnpm --filter @zebric/runtime test

# Watch mode for development
pnpm dev
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

Zebric is an experimental framework in active development. Some important limitations:

- **Production readiness**: This is a development tool, not yet battle-tested for production use
- **Database support**: Only SQLite and PostgreSQL support are available, MySQL is planned in the future, but should not be a major issue
- **Client-side interactivity**: Limited JavaScript; primarily server-rendered HTML with form submissions
- **Performance**: The runtime interpretation approach trades some performance for development speed - this needs to be quantified
- **Ecosystem**: Plugin ecosystem is just getting started for common functionality
- **Documentation**: Documentation is a work in progress
- **Breaking changes**: The Blueprint schema and API may change as the project evolves, and improvements need to be made. To the extent possible, these will be non-breaking changes.

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
- Projects requiring specific integrations or APIs that aren't easy to integrate in a custom plugin or behavior
- Applications with strict performance requirements

## Documentation

### Core Documentation
- [`docs/Zebric-Framework-Specification.md`](docs/Zebric-Framework-Specification.md) - Framework overview
- [`docs/Zebric-Engine-Architecture.md`](docs/Zebric-Engine-Architecture.md) - Architecture details
- [`docs/Zebric-Engine-Specification.md`](docs/Zebric-Engine-Specification.md) - Implementation specification

### Feature Documentation
- [`docs/quickstart.md`](docs/quickstart.md) - Generate a blueprint with an LLM and run it
- [`docs/blueprint-specification.md`](docs/blueprint-specification.md) - LLM-Readable description of a Zebric Blueprint
- [`docs/html-rendering.md`](docs/html-rendering.md) - HTML rendering guide
- [`docs/api-stability.md`](docs/api-stability.md) - API stability guarantees and experimental features

### Development Documentation
- [`docs/version-management.md`](docs/version-management.md) - How to manage versions and releases with Changesets
- [`TESTING.md`](TESTING.md) - Testing documentation

### Implementation Summaries
- `CHANGELOG.md` - Full changelog

## License

MIT License - Copyright (c) 2025 Biscotti Labs LLC
