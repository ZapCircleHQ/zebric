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

## [Unreleased]

### Added
- TBD

### Changed
- TBD

### Fixed
- TBD

---

[0.1.0]: https://github.com/yourusername/zebric/releases/tag/v0.1.0
