# Changelog

All notable changes to the Zebric repository are documented in this file.

This changelog is a high-level project summary. Package versioning and publishing are managed with Changesets.

## [0.3.0] - 2026-04-23

### Added

- Added the first pass of client-side widgets, including a new `issue-board` example.
- Added benchmarking and diagnostics work, including admin-server metrics, route timing diagnostics, and Docker Compose benchmark coverage.

### Changed

- Updated core dependencies across the repo, including React, TypeScript, Vitest, ESLint, Turbo, Hono, Better Auth, Drizzle, and Cloudflare tooling.
- Improved the documentation and playground sites, including docs-site dependency updates and fixes for playground links and browser behavior.
- Continued tightening CI and quality gates with browser-test targeting, coverage checks, and smaller workflow cleanups.

### Fixed

- Fixed several playground regressions, including URL handling, browser navigation behavior, and a `useRef` runtime error.

## [0.2.2] - 2026-03-24

### Added

- Added `@zebric/observability` for structured logging, correlation IDs, redaction, and Hono middleware support.

### Changed

- Expanded Cloudflare Workers test coverage and improved behavior parity checks between the Node and Workers runtimes.
- Improved CLI and runtime error messages to make local debugging and remediation easier.
- Strengthened docs quality checks, build validation, and worker-focused documentation.

## [0.2.1] - 2026-02-17

### Added

- Added OpenAPI generation from Blueprint definitions.
- Added API key authentication for agents, REST APIs, and external integrations.
- Added Slack notifications and multi-channel notification management.
- Added layout slots, action bars, related-data sections, and auth-page layout support.
- Added the `zebric-dispatch` example for dispatch and logistics workflows.

### Changed

- Refactored major runtime modules into smaller focused units without changing public APIs.
- Expanded test coverage substantially across rendering, request handling, and engine behavior.

### Fixed

- Fixed several security issues across CSRF handling, login redirects, file resolution, workflow input filtering, action-route auth enforcement, and HTML escaping.

## [0.1.0] - 2025-10-17

### Added

- First public release of Zebric as a Blueprint-driven runtime for building server-rendered web applications without code generation.
- Initial support for routing, forms, HTML rendering, authentication, CRUD data access, themes, plugins, and development tooling.

[0.3.0]: https://github.com/ZapCircleHQ/zebric/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/ZapCircleHQ/zebric/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ZapCircleHQ/zebric/compare/v0.1.0...v0.2.1
[0.1.0]: https://github.com/ZapCircleHQ/zebric/releases/tag/v0.1.0
