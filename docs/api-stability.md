# Zebric API Stability and Experimental Features

This document outlines the stability guarantees for different parts of the Zebric framework, marking experimental features and documenting which APIs are stable versus subject to change.

## Version: 0.1.x - Initial Release Phase

**Release Status**: Public Beta
**Stability Level**: Development/Experimental
**Last Updated**: 2025-10-22

---

## Stability Guarantees

### What "Stable" Means in 0.1.x

In version 0.1.x, "stable" means:
- **Feature Complete**: The feature works as documented
- **Tested**: Has unit and integration test coverage
- **Semantic Versioning**: Breaking changes will increment minor version (0.1 → 0.2)
- **Deprecation Warnings**: Changes will be announced with clear migration paths

### What "Experimental" Means

Experimental features are:
- **Functional**: They work but may have edge cases
- **Subject to Change**: API or behavior may change without major version bump
- **Feedback Welcome**: We're actively seeking user input on the design
- **Documentation**: May have incomplete documentation

### Compatibility Promise

Starting with 0.2.0, we will follow **semantic versioning**:
- **Patch releases** (0.2.x): Bug fixes, no breaking changes
- **Minor releases** (0.x.0): New features, deprecations, may include breaking changes until 1.0
- **Major releases** (x.0.0): Breaking changes, major rewrites

---

## Blueprint Specification Stability

### ✅ Stable Blueprint Features

These Blueprint fields and structures are stable and will maintain backward compatibility:

#### Core Structure
```toml
version = "0.1.0"

[project]
name = "My App"
version = "1.0.0"
description = "..."

[project.runtime]
min_version = "0.1.0"
```
**Status**: ✅ Stable
**Compatibility**: Will be supported in all 0.x and 1.x versions

#### Entity Definitions (Basic)
```toml
[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", unique = true, required = true },
  { name = "name", type = "Text", required = true },
  { name = "createdAt", type = "DateTime", default = "now" }
]
```
**Status**: ✅ Stable
**Supported Types**: ULID, Text, LongText, Integer, Float, Boolean, Date, DateTime, Email, URL, Enum, Ref
**Compatibility**: Core field types will remain supported

#### Page Definitions (Basic)
```toml
[page."/"]
title = "Home"
auth = "none"
layout = "list"

[page."/".query.posts]
entity = "Post"
where = { status = "published" }
orderBy = { createdAt = "desc" }
limit = 10
```
**Status**: ✅ Stable
**Compatibility**: Basic page routing and queries will remain supported

#### Form Definitions
```toml
[page."/posts/new".form]
entity = "Post"
method = "create"

[[page."/posts/new".form.fields]]
name = "title"
type = "text"
required = true
```
**Status**: ✅ Stable
**Field Types**: text, textarea, email, password, number, date, select, checkbox, radio, file
**Compatibility**: Core form field types will remain supported

#### Authentication (Email/Password)
```toml
[auth]
providers = ["email"]
trustedOrigins = ["http://localhost:3000"]
```
**Status**: ✅ Stable
**Compatibility**: Email/password auth will remain supported

---

### ⚠️ Experimental Blueprint Features

These features work but may change in future versions:

#### Entity Relationships
```toml
[entity.Post.relations]
author = { type = "belongsTo", entity = "User", foreign_key = "authorId" }
```
**Status**: ⚠️ Experimental
**Reason**: Relationship API may be refined based on user feedback
**Planned Stability**: 0.2.0

#### Access Control (Complex Rules)
```toml
[entity.Post.access]
read = { or = [{ status = "published" }, { authorId = "$currentUser.id" }] }
update = { and = [{ authorId = "$currentUser.id" }, { "$currentUser.role" = "admin" }] }
```
**Status**: ⚠️ Experimental
**Reason**: Access control DSL may be enhanced with more operators
**Planned Stability**: 0.2.0

#### Workflows
```toml
[workflow.send_welcome_email]
trigger = { entity = "User", event = "create" }

[[workflow.send_welcome_email.steps]]
type = "webhook"
url = "https://api.sendgrid.com/v3/mail/send"
```
**Status**: ⚠️ Experimental
**Reason**: Workflow system is functional but may see significant enhancements
**Planned Stability**: 0.3.0

#### Custom Behaviors
```toml
[page."/dashboard".behavior]
intent = "Show a kanban board..."
render = "./behaviors/dashboard-render.js"
```
**Status**: ⚠️ Experimental
**Reason**: Behavior API is still evolving
**Planned Stability**: 0.2.0

#### File Uploads
```toml
[[page."/documents/upload".form.fields]]
name = "file"
type = "file"
accept = ["application/pdf"]
max = 10485760
```
**Status**: ⚠️ Experimental (Added in 0.1.1)
**Reason**: New feature, cloud storage integration pending
**Planned Stability**: 0.2.0 (with S3/R2 support)

---

## Runtime API Stability

### ✅ Stable Runtime APIs

#### CLI Commands
```bash
zebric dev blueprint.toml
zebric start blueprint.toml --port 3000
```
**Status**: ✅ Stable
**Compatibility**: Core commands will remain supported

#### Health Endpoint
```
GET /health
```
**Status**: ✅ Stable
**Compatibility**: Endpoint will always be available

---

### ⚠️ Experimental Runtime APIs

#### Admin API
```
GET /admin/metrics
GET /admin/state
POST /admin/reload
```
**Status**: ⚠️ Experimental
**Reason**: Admin API may be expanded or restructured
**Planned Stability**: 0.2.0

#### Plugin API (Programmatic)
```typescript
import { ZebricEngine } from '@zebric/runtime'
const engine = new ZebricEngine(config)
await engine.start()
```
**Status**: ⚠️ Experimental
**Reason**: Programmatic API is being refined for AI tools
**Planned Stability**: 0.2.0

#### Blueprint Validation API
```typescript
import { validateBlueprint } from '@zebric/runtime'
const result = await validateBlueprint(blueprintContent)
```
**Status**: ⚠️ Not Yet Implemented
**Planned**: 0.1.2 (AI Tooling Readiness)

---

## Plugin System Stability

### ✅ Stable Plugin Features

#### Plugin Structure
```typescript
export default {
  name: '@mycompany/my-plugin',
  version: '1.0.0',
  provides: ['layouts', 'middleware'],

  async init(engine, config) {
    // Initialize plugin
  }
}
```
**Status**: ✅ Stable
**Compatibility**: Basic plugin structure will remain supported

---

### ⚠️ Experimental Plugin Features

#### Plugin Sandbox
```toml
[plugin."@mycompany/limited-plugin"]
trust_level = "limited"
capabilities = ["database", "network"]
```
**Status**: ⚠️ Experimental
**Limitation**: Plugin init() runs outside sandbox in 0.1.x
**Reason**: VM-based sandboxing doesn't work with pre-compiled functions
**Planned**: Full sandboxing in 0.2.0 (Worker Threads or isolated-vm)

#### Plugin Workflows
```typescript
export default {
  workflows: {
    async customAction(params, context) {
      // Custom workflow action
    }
  }
}
```
**Status**: ⚠️ Experimental
**Reason**: Workflow plugin API may change
**Planned Stability**: 0.3.0

---

## Database Support Stability

### ✅ Stable Database Features

- **SQLite**: Fully supported for development
- **PostgreSQL**: Fully supported for production
- **Schema Migrations**: Automatic schema sync
- **CRUD Operations**: Full support via Drizzle ORM

### ⚠️ Experimental Database Features

- **MySQL/MariaDB**: Planned for 0.2.0
- **Connection Pooling**: Works but configuration options may expand
- **Multi-tenancy**: Not yet implemented

---

## Breaking Change Policy

### Until 1.0.0

- Breaking changes may occur in minor versions (0.1 → 0.2)
- All breaking changes will be documented in CHANGELOG.md
- Deprecated features will include warnings for at least one minor version
- Migration guides will be provided for significant changes

### After 1.0.0

- Breaking changes only in major versions (1.0 → 2.0)
- Deprecations announced two minor versions before removal
- Comprehensive migration guides for all breaking changes

---

## Deprecation Process

When features need to change:

1. **Warning Phase**: Console warnings when deprecated feature is used
2. **Documentation**: Updated docs show both old and new approaches
3. **Migration Guide**: Step-by-step guide published
4. **Grace Period**: Minimum one minor version before removal
5. **Removal**: Feature removed in next minor version (before 1.0) or major version (after 1.0)

---

## Experimental Feature Tracking

### 0.1.0 Experimental Features

- ⚠️ Entity Relationships (targeting stable in 0.2.0)
- ⚠️ Complex Access Control Rules (targeting stable in 0.2.0)
- ⚠️ Workflows (targeting stable in 0.3.0)
- ⚠️ Custom Behaviors (targeting stable in 0.2.0)
- ⚠️ File Uploads (targeting stable in 0.2.0 with cloud storage)
- ⚠️ Plugin Sandboxing (targeting proper implementation in 0.2.0)
- ⚠️ Admin API (targeting stable in 0.2.0)
- ⚠️ Programmatic Runtime API (targeting stable in 0.2.0)

### Features Planned for Stabilization

#### 0.1.2 (AI Tooling Readiness)
- Blueprint JSON Schema export
- Structured error messages
- Blueprint Validation API
- Programmatic Runtime API
- Headless mode

#### 0.2.0 (Production Ready)
- Entity relationships
- Access control
- File uploads with cloud storage
- Plugin sandboxing (Worker Threads)
- MySQL support
- API-only mode
- Stable Blueprint schema version 1.0

---

## Recommendations

### For Early Adopters (0.1.x)

✅ **Safe to use:**
- Basic entity definitions
- Simple page routing
- Standard form fields
- Email/password authentication
- SQLite or PostgreSQL databases
- Basic plugins (trust_level = "full")

⚠️ **Use with caution:**
- Entity relationships (may need schema updates)
- Complex access rules (DSL may change)
- Workflows (API may evolve)
- File uploads (cloud storage coming)
- Plugin sandboxing (not yet implemented)

### For Production Use (Wait for 0.2.x)

0.2.x will include:
- Stable Blueprint schema (version 1.0)
- Commitment to backward compatibility
- Production deployment guides
- Multi-instance deployment support
- BullMQ for distributed jobs
- Enhanced health checks
- OpenTelemetry support

---

## Questions or Feedback?

If you have questions about API stability or concerns about experimental features:

- **GitHub Issues**: https://github.com/ZapCircleHQ/zebric/issues
- **Discussions**: Share your use case and we'll advise on stability
- **Documentation**: Check ROADMAP.md for planned stabilization timeline

---

**Note**: This document will be updated with each minor release to reflect the current stability status of all features.
