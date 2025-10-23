# Zebric Roadmap

This roadmap outlines the planned development of Zebric as a runtime platform for AI-generated applications and rapid prototyping.

## Vision

Zebric serves as a **solid foundation for AI code generation tools** by providing:
- **Token-efficient output**: Declarative Blueprints instead of thousands of lines of generated code
- **Understandable configuration**: Easy for humans to read, modify, and maintain
- **Built-in best practices**: Security, authentication, and validation by default
- **Easy deployment path**: From POC to production without vendor lock-in
- **Escape hatch**: Extend with plugins, fork the runtime, or migrate to traditional frameworks

While most projects will remain proofs-of-concept, Zebric ensures they're production-capable and maintainable.

---

## Release Strategy

### Version 0.1.x - Foundation & Stability
**Goal**: Establish Zebric as a reliable platform for AI tools and developers

### Version 0.2.0 - Production Ready
**Goal**: Full production readiness with stable APIs and comprehensive features

---

## Detailed Roadmap

### **0.1.1** - Immediate Stability
**Status**: Finished
**Goal**: Polish the initial release and fix critical issues

#### Fixes
- [x] Fix Sign Up Link in Auth
- [x] Make Home Page display the home page and not JSON configuration
- [x] Fix flaky integration tests
- [x] Plugin sandbox security (documented limitation, full implementation moved to 0.2.0)
- [x] Validate and fix all example applications
- [x] Update documentation with npm installation instructions

#### Documentation
- [x] Mark experimental features clearly in docs
- [x] Add stability guarantees section
- [x] Document which APIs are stable vs. subject to change

---

### **0.1.2** - AI Tooling Readiness ⭐ Priority
**Status**: Planned
**Goal**: Make Zebric a preferred target for AI app building tools

This release is critical for building AI-powered app builders (like a "vibe coding" tool) on top of Zebric.

#### AI Tool Integration
- [ ] **JSON Schema for Blueprint** - Enable AI validation before code generation
  - Export complete JSON Schema for Blueprint format
  - Support both TOML and JSON Blueprint validation
  - Include examples and field descriptions in schema

- [ ] **Structured Error Messages** - Parseable validation errors for AI tools
  - Error codes and structured error objects
  - Actionable fix suggestions in error messages
  - Line/column information for Blueprint errors

- [ ] **Blueprint Validation API** - Programmatic validation without running server
  ```typescript
  import { validateBlueprint } from '@zebric/runtime';
  const result = await validateBlueprint(blueprintContent);
  ```

- [ ] **Programmatic Runtime API** - Control server lifecycle from code
  ```typescript
  import { ZebricEngine } from '@zebric/runtime';
  const engine = new ZebricEngine(blueprint);
  await engine.start();
  await engine.reload(newBlueprint);
  await engine.stop();
  ```

- [ ] **Headless Mode** - Structured JSON logs instead of CLI pretty-printing
  - `--headless` flag for CLI
  - JSON-formatted log output
  - Programmatic event listeners for errors/warnings

#### Documentation
- [ ] "Building AI Tools with Zebric" guide
- [ ] API reference for programmatic usage
- [ ] Blueprint generation best practices for AI

---

### **0.1.3** - Feature Completeness
**Status**: Planned
**Goal**: Essential features for real-world POCs and applications

#### Database
- [ ] **Complete PostgreSQL support**
  - Fix remaining PostgreSQL compatibility issues
  - PostgreSQL-specific tests
  - Connection pooling improvements
  - Migration guide from SQLite to PostgreSQL

- [ ] **Entity Relationships** - Critical for multi-entity apps
  - One-to-many relationships (foreign keys)
  - Many-to-many relationships (join tables)
  - Relationship queries in views
  - Cascade delete options
  - Relationship validation

#### File Handling (In Progress)
- [ ] **File Upload Support** - Critical for multi-instance deployments
  - Image uploads with preview
  - Document uploads
  - File size and type validation
  - **S3/Cloud storage support** (required for horizontal scaling)
  - Local filesystem option (development only)
  - Image resizing/optimization
  - Signed URL generation for downloads

#### User Experience
- [ ] **Search and Filtering** - Essential for list views
  - Text search across entity fields
  - Filter by field values
  - Sort by any field
  - Pagination improvements

- [ ] **Better Form Validation**
  - Custom validation rules
  - Conditional field requirements
  - Better error message display
  - Field-level validation feedback

#### Production Deployment
- [ ] **Multi-Instance Deployment Documentation**
  - PostgreSQL setup and configuration
  - Redis configuration for shared cache
  - Environment variable reference
  - Load balancer configuration examples
  - Zero-downtime deployment guide

- [ ] **Health Check Improvements**
  - Enhanced `/health` endpoint
  - Database connection health check
  - Redis connection health check
  - Readiness vs. liveness probes

---

### **0.2.0** - Production Ready Platform
**Status**: Planned
**Goal**: Enterprise-grade stability and comprehensive feature set

#### Core Platform
- [ ] **Stable Blueprint Schema**
  - Commit to backward compatibility
  - Semantic versioning for schema changes
  - Blueprint version field (`blueprint_version: "1.0"`)
  - Deprecation warnings for old features

- [ ] **Migration System**
  - Automatic Blueprint upgrades
  - Database schema migration tools
  - Migration rollback support

- [ ] **MySQL Support**
  - Full MySQL/MariaDB compatibility
  - MySQL-specific tests
  - Connection pooling and optimization

#### Advanced Features
- [ ] **Advanced Access Control**
  - Row-level permissions
  - Custom permission rules
  - Team/organization support
  - Audit logging improvements

- [ ] **API-Only Mode**
  - JSON API responses (no HTML)
  - REST API documentation generation
  - GraphQL support (experimental)
  - API authentication (JWT, API keys)
  - Enable mobile/SPA front ends

#### Client-Side Enhancements
- [ ] **Optional Interactivity Framework**
  - Alpine.js integration for progressive enhancement
  - OR htmx support for HATEOAS patterns
  - Client-side form validation
  - Real-time updates (WebSocket support)

- [ ] **Advanced Form Features**
  - Multi-step forms
  - Conditional field visibility
  - Dynamic field generation
  - Rich text editor support

#### Plugin Ecosystem
- [ ] **Official Plugins** (3-5 core plugins)
  - Rich text editor (TipTap or similar)
  - Charts and visualizations
  - File/media browser
  - Data export (CSV, Excel)
  - Email templates

- [ ] **Plugin Development Tools**
  - `zebric plugin create` CLI command
  - Plugin templates and examples
  - Plugin testing utilities
  - Plugin documentation guide

- [ ] **Theme Development**
  - Theme development guide
  - Additional built-in themes
  - Theme customization tools

#### Background Jobs & Workflows
- [ ] **BullMQ Integration** - Critical for distributed job processing
  - Migrate from in-memory WorkflowQueue to BullMQ
  - Redis-backed job queue (multi-instance safe)
  - Job persistence and retry logic
  - Failed job handling
  - Job progress tracking
  - Concurrent job processing across instances
  - Job events and monitoring

#### Production Readiness
- [ ] **Performance**
  - Benchmark suite (requests/sec, latency)
  - Query optimization
  - Caching strategies
  - CDN integration for static assets

- [ ] **Deployment**
  - Docker images for runtime
  - Docker Compose examples (app + PostgreSQL + Redis)
  - Deployment guides (Railway, Render, Fly.io, Vercel)
  - Kubernetes manifests and Helm charts
  - Environment configuration best practices
  - **Multi-instance deployment architecture guide**
  - Health check endpoint improvements

- [ ] **Monitoring & Observability**
  - **OpenTelemetry support for distributed tracing**
  - **Centralized metrics aggregation** (currently per-instance only)
  - Enhanced Prometheus metrics
  - Structured logging improvements
  - Error tracking integration (Sentry, etc.)
  - Request correlation IDs across instances

#### Documentation
- [ ] Complete API reference
- [ ] **Production deployment guide** (multi-instance, PostgreSQL + Redis)
- [ ] **Scaling guide** (horizontal scaling, load balancing, zero-downtime deploys)
- [ ] Performance tuning guide
- [ ] Security best practices
- [ ] Video tutorials/screencasts
- [ ] Case studies and examples

---

## Multi-Instance Deployment Readiness

Based on architecture analysis, here's the current state of production readiness for multi-instance deployments:

### ✅ Production-Ready Today (0.1.0)
- **HTTP Request Handling**: Fully stateless, load-balancer friendly
- **Authentication**: Database-backed sessions work across instances
- **Database Layer**: PostgreSQL with connection pooling
- **Cache Layer**: Redis support built-in
- **Authorization**: Access control from shared database
- **Security**: CSRF, rate limiting, security headers

### ⚠️ Needs Configuration (0.1.3)
- **File Uploads**: Requires S3/cloud storage (not local filesystem)
- **Health Checks**: Enhanced health endpoints for load balancers
- **Documentation**: Multi-instance setup guide

### 🔧 Needs Development (0.2.0)
- **Workflows/Background Jobs**: Currently in-memory, needs BullMQ migration
- **Distributed Tracing**: Currently per-instance, needs OpenTelemetry
- **Metrics Aggregation**: Currently per-instance, needs centralized collection

### Production Architecture (0.2.0)
```
Load Balancer (sticky sessions optional)
    ↓
    ├─ Zebric Instance 1 ─┐
    ├─ Zebric Instance 2 ─┼─→ PostgreSQL (shared)
    └─ Zebric Instance N ─┘      ↓
         ↓                    Redis (cache + jobs)
    BullMQ Workers
```

**Environment Requirements:**
```bash
# Required for multi-instance
DATABASE_URL=postgresql://...      # Shared database
REDIS_URL=redis://...              # Shared cache + jobs
BETTER_AUTH_SECRET=...             # Consistent across instances
NODE_ENV=production
BASE_URL=https://your-domain.com

# Optional optimization
HOST=0.0.0.0
PORT=3000
RATE_LIMIT_MAX=100
```

---

## Beyond 0.2.0 - Future Considerations

These are ideas for future major releases, subject to community feedback:

### Developer Experience
- Visual Blueprint editor (web-based)
- Blueprint diff/merge tools
- Live collaboration on Blueprints
- Blueprint marketplace/sharing

### Advanced Features
- Multi-tenancy support
- Internationalization (i18n)
- Full-text search (Elasticsearch, Meilisearch)
- Real-time subscriptions (GraphQL)
- Serverless deployment support

### Ecosystem
- Official Zebric hosting platform
- Plugin marketplace
- Template/starter gallery
- Community themes and plugins

### Enterprise Features
- SSO/SAML support
- Advanced compliance (SOC2, HIPAA)
- Backup/restore automation
- Multi-region deployment

---

## Contributing

We welcome community input on this roadmap! If you have:
- **Feature requests**: Open an issue with the `enhancement` label
- **Bug reports**: These take priority over new features
- **Use case feedback**: Share what you're building and what's blocking you

The roadmap is a living document and will evolve based on real-world usage and community needs.

---

## Release Timing

This roadmap is **aspirational** and subject to change. Rough timeline:
- **0.1.1**: 1-2 weeks from 0.1.0
- **0.1.2**: 3-5 weeks from 0.1.0
- **0.1.3**: 6-10 weeks from 0.1.0
- **0.2.0**: 12-18 weeks from 0.1.0

Actual release dates depend on:
- Community contributions
- Bug severity and volume
- Complexity of implementation
- Real-world usage feedback

---

**Last Updated**: 2025-10-23
**Current Version**: 0.1.1
