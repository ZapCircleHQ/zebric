# Changelog

All notable changes to the Zebric Framework will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-10-17

### Initial Release

First public release of Zebric Framework - a declarative web application framework that interprets Blueprint configuration files at runtime.

#### Core Features

**Runtime Engine**
- Blueprint JSON/TOML interpretation at runtime (no code generation)
- Hot reload support for development
- Plugin system for extensibility
- Custom theme support

**HTTP & Routing**
- Dynamic route matching (`/posts/:id`)
- Support for GET, POST, PUT, DELETE methods
- Form validation and submission
- Query parameter handling

**Database**
- Automatic schema generation from Blueprint entities
- CRUD operations via Drizzle ORM
- SQLite support (PostgreSQL in development)
- Auto-generated REST API endpoints
- Entity-level and field-level access control

**Authentication & Security**
- Email/password authentication via Better Auth
- Session management
- Role-based access control (RBAC)
- Field-level read/write restrictions
- CSRF protection
- Security headers (CSP, X-Frame-Options, etc.)
- Audit logging
- Error sanitization

**HTML Rendering**
- Server-side HTML generation
- Four layout types: list, detail, form, dashboard
- Tailwind CSS styling (CDN)
- View Transitions API support
- Custom theme system

**Developer Tools**
- CLI tools (`zebric`, `zebric-engine`)
- Hot reload with WebSocket notifications
- Admin debug endpoints
- Request tracing and metrics (Prometheus format)
- Comprehensive error handling

**Workflows** (Experimental)
- Background job processing via BullMQ
- Webhook triggers
- HTTP actions
- Email actions (placeholder)

#### Packages

- `@zebric/runtime` - Core runtime engine
- `@zebric/cli` - Command-line tools

#### Plugins

- `@zebric-plugin/card-grid-layout` - Card grid layout renderer

#### Examples

- Blog - Simple blog with posts
- Task Tracker - Todo app with authentication
- Custom Theme - Demonstrates theme customization
- Vibe - Chat application example

#### Known Limitations

- Only SQLite fully supported (PostgreSQL partial)
- Limited client-side interactivity
- Small plugin ecosystem
- Integration tests can be flaky
- Not yet production-tested at scale

#### Breaking Changes

N/A - Initial release

---

## [0.2.1] - 2026-02-17

### Added

**OpenAPI & API Keys**
- OpenAPI specification generation from Blueprint definitions
- API key authentication for agents, REST APIs, and external integrations
- Skills support in Blueprints

**Notifications**
- Slack notification adapter with inbound webhook handling
- Notification manager for multi-channel delivery

**Rendering**
- Layout slot system for customizing list, detail, form, and dashboard layouts
- Action bar component for detail pages with workflow actions, status display, and primary/secondary actions
- Related data sections with smart rendering (checklists, timelines, activity feeds)
- Auth page layout for sign-in flows

**Zebric Dispatch Example**
- New example application demonstrating dispatch/logistics workflows
- External signal handling and Slack integration

### Changed

**Architecture & Refactoring**
- Split monolithic `server-manager.ts` into focused modules (server-routes, server-security, server-utils, session-handlers)
- Split `component-renderers.ts` (741 lines) into `form-renderers.ts`, `action-bar-renderer.ts`, and `data-section-renderers.ts`
- Split `request-handler.ts` (730 lines) into `request-utils.ts`, `form-processor.ts`, and `session-resolver.ts`
- Split `engine.ts` (656 lines) into `engine-port-factory.ts` and `engine-lifecycle.ts`
- Split `layout-renderers.ts` (480 lines) — extracted `slot-renderer.ts`
- All refactoring preserves existing public APIs; no breaking changes

**Test Coverage**
- Added 120+ tests covering component renderers, layout renderers, request handler, and engine
- Total test suite: 487 tests across 29 test files
- Added vitest code coverage reporting

### Fixed

**Security**
- CSRF protection improvements and validation of API keys for CSRF skip
- Open redirect prevention in login redirect flows
- Path traversal fix in file resolve
- Workflow body filtering to prevent injection
- Authentication enforcement on action routes
- HTML entity decoding bypass for safe HTML rendering

### Packages

- `@zebric/runtime-core` - Core rendering, routing, and types
- `@zebric/runtime-node` - Node.js runtime engine
- `@zebric/runtime-hono` - Hono HTTP adapter
- `@zebric/runtime-worker` - Cloudflare Workers runtime
- `@zebric/cli` - Command-line tools
- `@zebric/notifications` - Notification delivery (new)
- `@zebric/plugin-sdk` - Plugin development kit
- `@zebric/themes` - Theme packages

---

## [0.1.0] - 2025-10-17

### Initial Release

First public release of Zebric Framework - a declarative web application framework that interprets Blueprint configuration files at runtime.

---

[0.2.1]: https://github.com/yourusername/zebric/compare/v0.1.0...v0.2.1
[0.1.0]: https://github.com/yourusername/zebric/releases/tag/v0.1.0
