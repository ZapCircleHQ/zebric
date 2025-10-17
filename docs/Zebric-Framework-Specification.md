# Zebric Framework Specification v0.1
## Runtime Architecture

---

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [Architecture Overview](#2-architecture-overview)
3. [Zebric Specification](#3-zebric-specification)
4. [Blueprint Schema](#4-blueprint-schema)
5. [Runtime Engine Contract](#5-runtime-engine-contract)
6. [Plugin System](#6-plugin-system)
7. [Provider Adapters](#7-provider-adapters)
8. [Deployment Model](#8-deployment-model)
9. [Migration System](#9-migration-system)
10. [Conformance Suite](#10-conformance-suite)

---

## 1. Vision & Philosophy

### What is Zebric?

**Zebric** is a declarative framework for building full-stack web applications that run on **runtime engines** - no code generation, no compilation step, just pure interpretation.

### Core Principles

1. **Runtime-First**: Blueprints are interpreted at runtime, never compiled to code
2. **Plugin-Based**: Extend functionality through plugins, not code ejection
3. **AI-Native**: Designed for continuous AI iteration without code drift
4. **Provider Agnostic**: Same Blueprint runs on any cloud provider
5. **Hot-Reloadable**: Change Blueprint, engine reacts instantly
6. **Deterministic**: Same Blueprint + same engine version = identical behavior

### The Runtime Philosophy

**Traditional AI Coding Tools**:
```
Prompt → Generate Code → [STOP] → Developer maintains code
```
Problems: Code drift, AI can't iterate, merge conflicts, technical debt

**Zebric Runtime Approach**:
```
Prompt → Update Blueprint → Engine Reacts → Keep Iterating
```
Benefits: No code drift, infinite iteration, always in sync

### What Zebric Is NOT

- ❌ Not a code generator (it's a runtime interpreter)
- ❌ Not a scaffolding tool (it's a live application platform)
- ❌ Not language-specific (engines can be any language)
- ❌ Not a build tool (there's nothing to build)

### Architecture Overview

```
┌─────────────────────────────────────────────┐
│  TOML or JSON Files (Developer/AI writes these)│
│  - Entities, Pages, Workflows, Auth        │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Planner (Validates)                        │
│  - Parse TOML or JSON                       │
│  - Validate references                      │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Runtime Engine (Interprets Blueprint)      │
│  - Loads Blueprint at startup               │
│  - Interprets routes, queries, workflows    │
│  - Hot-reloads on Blueprint changes         │
│  - Loads plugins from disk/npm              │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Running Application                        │
│  - HTTP server serving pages                │
│  - Database queries executed                │
│  - Workflows processing                     │
│  - UI rendered from Blueprint               │
└─────────────────────────────────────────────┘
```

---

## 2. Architecture Overview

### Components

**1. Blueprint TOML**
- Human/AI writable declarative syntax
- Describes entities, pages, workflows, permissions
- Portable across engines
- Source of truth for application

**2. Validator**
- Validates TOML syntax
- Checks entity references, permissions, etc.
- Generates semantic diffs
- Does NOT generate code

**3. Runtime Engine**
- Interprets Blueprint at runtime
- Provides HTTP server, database, auth, workflows
- Loads plugins for extensibility
- Hot-reloads when Blueprint changes
- Never generates code files

**4. Plugins**
- Extend engine functionality
- Provide custom workflow steps
- Provide custom UI components
- Provide custom integrations
- Have full access to engine APIs

**5. Provider Adapters**
- Deploy Blueprint + Engine to infrastructure
- Handle provider-specific concerns (D1, Postgres, R2, S3)
- Engine core remains provider-agnostic

---

## 3. Zebric Blueprint Specification

### 3.1 Project Metadata

```toml
[project]
name = "my-blog"
version = "1.0.0"
description = "A simple blog"

[project.runtime]
min_version = "0.1.0"  # Minimum engine version
```

### 3.2 Entities

```toml
[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", unique = true, index = true },
  { name = "name", type = "Text", required = true },
  { name = "role", type = "Enum", values = ["user", "admin"], default = "user" }
]

[entity.User.relations]
posts = { type = "hasMany", entity = "Post", foreign_key = "authorId" }

[entity.Post]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "slug", type = "Text", unique = true, index = true },
  { name = "body", type = "LongText", required = true },
  { name = "status", type = "Enum", values = ["draft", "published"], default = "draft" },
  { name = "authorId", type = "Ref", ref = "User.id", index = true }
]

[entity.Post.relations]
author = { type = "belongsTo", entity = "User", foreign_key = "authorId" }

[entity.Post.access]
read = { or = [{ status = "published" }, { authorId = "$currentUser.id" }] }
create = true
update = { or = [{ authorId = "$currentUser.id" }, { "$currentUser.role" = "admin" }] }
delete = { "$currentUser.role" = "admin" }
```

### 3.3 Pages

```toml
[page."/posts"]
title = "All Posts"
auth = "required"
layout = "list"  # Engine interprets this, doesn't generate code

[page."/posts".query.posts]
entity = "Post"
where = { status = "published" }
orderBy = { createdAt = "desc" }
limit = 20
include = ["author"]

[page."/posts/new"]
title = "New Post"
auth = "required"
layout = "form"

[page."/posts/new".form]
entity = "Post"
method = "create"
onSuccess = { redirect = "/posts/{id}" }

[[page."/posts/new".form.fields]]
name = "title"
type = "text"
required = true

[[page."/posts/new".form.fields]]
name = "body"
type = "textarea"
rows = 20
```

### 3.4 Workflows

```toml
[workflow.onPostPublished]
trigger = { entity = "Post", event = "update", condition = { status = { changed_to = "published" } } }

[[workflow.onPostPublished.steps]]
type = "email"
to = "{{ Post.author.email }}"
subject = "Your post is live!"
template = "post_published"

[[workflow.onPostPublished.steps]]
type = "plugin"  # Use plugin for custom logic
plugin = "@mycompany/notifications"
action = "sendSlackNotification"
params = { userId = "{{ Post.authorId }}", message = "Post published!" }
```

### 3.5 Auth

```toml
[auth]
providers = ["email", "google"]

[auth.email]
verify = true

[auth.google]
clientId = "${GOOGLE_CLIENT_ID}"
clientSecret = "${GOOGLE_CLIENT_SECRET}"

[auth.permissions.admin]
allow = ["Post.*", "User.*"]

[auth.permissions.user]
allow = [
  "Post.read",
  { entity = "Post", actions = ["create", "update"], condition = { authorId = "$currentUser.id" } }
]
```

### 3.6 Plugins

```toml
# Install plugin from npm
[plugin."@mycompany/custom-auth"]
version = "^1.0.0"
enabled = true
config = { apiKey = "${MYCOMPANY_API_KEY}" }

# Install local plugin
[plugin."./plugins/custom-workflow"]
enabled = true

# Use plugin as auth provider
[auth]
provider = "plugin:@mycompany/custom-auth"

# Use plugin in workflow
[[workflow.steps]]
type = "plugin"
plugin = "@mycompany/custom-workflow"
action = "doSomething"
```

### 3.7 UI Configuration

```toml
[ui]
# Rendering strategy
render_mode = "server"  # "server" (default), "hybrid", "spa"

# Theme (Tailwind-based)
theme = "default"  # or "@mycompany/custom-theme"

# Progressive enhancement
progressive_enhancement = "alpine"  # "none", "alpine", "htmx"

# View Transitions API
view_transitions = true

# Tailwind customization
[ui.tailwind]
primary_color = "#3B82F6"
secondary_color = "#8B5CF6"
font_family = "Inter, sans-serif"

# Custom CSS (optional)
[ui.css]
file = "./styles/custom.css"

# Layout renderers (all server-rendered by default)
[ui.layouts]
list = "default"      # Built-in server renderer
detail = "default"
form = "default"
custom = "plugin:@mycompany/custom-layout"  # Plugin provides custom renderer

# Component overrides (for advanced cases)
[ui.components]
Dropdown = "alpine:dropdown"  # Use Alpine.js component
Modal = "htmx:modal"          # Use HTMX component
```

---

## 4. Blueprint Schema

### Structure

```json
{
  "version": "0.1.0",
  "hash": "sha256:abc123...",
  "project": {
    "name": "my-blog",
    "version": "1.0.0",
    "runtime": {
      "min_version": "0.1.0"
    }
  },
  "entities": [...],
  "pages": [...],
  "workflows": [...],
  "auth": {...},
  "plugins": [...],
  "ui": {...}
}
```

### Plugins in Blueprint

```json
{
  "plugins": [
    {
      "name": "@mycompany/notifications",
      "version": "^1.0.0",
      "enabled": true,
      "config": {
        "apiKey": "${MYCOMPANY_API_KEY}"
      }
    }
  ]
}
```

---

## 5. Runtime Engine Contract

### Engine Interface

```typescript
interface RuntimeEngine {
  // Load and start
  load(blueprint: Blueprint): Promise<void>
  start(port: number): Promise<void>
  stop(): Promise<void>
  
  // Hot reload
  reload(newBlueprint: Blueprint): Promise<void>
  
  // Plugin system
  plugins: {
    load(plugin: Plugin): Promise<void>
    get(name: string): Plugin | undefined
    list(): Plugin[]
  }
  
  // Runtime state
  getBlueprint(): Blueprint
  getVersion(): string
  getHealth(): HealthStatus
}
```

### Request Handling (Runtime)

```typescript
// Engine interprets requests at runtime
class RequestHandler {
  async handle(request: Request): Promise<Response> {
    // 1. Match route from Blueprint (runtime lookup)
    const page = this.matchRoute(request.path, this.blueprint.pages)
    
    // 2. Check auth (runtime check)
    const session = await this.auth.getSession(request)
    if (page.auth === 'required' && !session) {
      return Response.redirect('/login')
    }
    
    // 3. Check permissions (runtime evaluation)
    const hasPermission = this.permissions.check(
      session,
      page.entity,
      page.action
    )
    
    // 4. Execute queries (runtime interpretation)
    const data = {}
    for (const [name, query] of Object.entries(page.queries)) {
      data[name] = await this.executeQuery(query, session, request.params)
    }
    
    // 5. Render page (runtime rendering)
    return this.renderer.render(page, data, session)
  }
}
```

### No Code Generation

```typescript
// ❌ Engine does NOT do this:
async function generateRouteFile(page: Page) {
  const code = `
    export async function handler(req, res) {
      const data = await db.query.posts.findMany()
      return res.json(data)
    }
  `
  await fs.writeFile('./routes/posts.ts', code)
}

// ✅ Engine DOES do this:
class RouteInterpreter {
  async interpret(page: Page, request: Request): Promise<Response> {
    // Interpret at runtime, no code generation
    const queryDef = page.queries['posts']
    const results = await this.db
      .select()
      .from(this.getTable(queryDef.entity))
      .where(this.buildWhere(queryDef.where))
      .limit(queryDef.limit)
    
    return { data: results }
  }
}
```

---

## 6. Plugin System

### Plugin Definition

```typescript
// @mycompany/custom-workflow/index.ts

export default definePlugin({
  name: '@mycompany/custom-workflow',
  version: '1.0.0',
  
  // What this plugin provides
  provides: {
    workflows: ['advanced-email', 'slack-notify'],
    components: ['AdvancedButton', 'CustomTable'],
    integrations: ['mycrm'],
    middleware: ['rate-limit']
  },
  
  // Engine APIs needed
  requires: {
    db: true,
    auth: true,
    storage: false
  },
  
  // Initialize plugin
  async init(engine: EngineAPI, config: PluginConfig) {
    // Setup
  },
  
  // Workflow steps
  workflows: {
    'advanced-email': async (params, context) => {
      // Access engine APIs
      const user = await context.db.query.users.findFirst({
        where: eq(users.id, params.userId)
      })
      
      // Custom logic
      await sendAdvancedEmail(user.email, params.message)
    },
    
    'slack-notify': async (params, context) => {
      await fetch('https://hooks.slack.com/...', {
        method: 'POST',
        body: JSON.stringify({ text: params.message })
      })
    }
  },
  
  // UI components (for theme plugins)
  components: {
    AdvancedButton: (props) => {
      return <button className="custom-style" {...props} />
    },
    
    CustomTable: ({ data, columns }) => {
      return <div>Custom table rendering</div>
    }
  },
  
  // Integrations
  integrations: {
    mycrm: {
      async createContact(data) {
        // Talk to CRM API
      },
      
      async updateContact(id, data) {
        // Update CRM
      }
    }
  },
  
  // Middleware
  middleware: {
    'rate-limit': async (request, reply, engine) => {
      // Rate limiting logic
      const key = request.ip
      const count = await engine.cache.incr(key)
      
      if (count > 100) {
        return reply.code(429).send({ error: 'Rate limit exceeded' })
      }
    }
  }
})
```

### Plugin Usage in Blueprint

```toml
# Install plugin
[plugin."@mycompany/custom-workflow"]
version = "^1.0.0"
enabled = true
config = { apiKey = "${MYCOMPANY_API_KEY}" }

# Use in workflow
[workflow.onSignup]
trigger = { entity = "User", event = "create" }

[[workflow.onSignup.steps]]
type = "plugin"
plugin = "@mycompany/custom-workflow"
action = "slack-notify"
params = { message = "New user: {{ User.email }}" }

# Use in UI
[ui]
theme = "@mycompany/design-system"  # Plugin provides components

[ui.overrides]
Button = "@mycompany/design-system/AdvancedButton"
```

### Plugin Discovery

```bash
# Plugins can be:
# 1. npm packages
npm install @mycompany/custom-workflow

# 2. Local directories
./plugins/
  └── custom-workflow/
      ├── package.json
      └── index.ts

# 3. Git repositories
[plugin."github:mycompany/plugin"]
ref = "main"
```

### Engine Plugin API

```typescript
interface EngineAPI {
  // Database access
  db: DrizzleDB
  
  // Auth access
  auth: {
    getCurrentUser(request: Request): Promise<User | null>
    createSession(userId: string): Promise<Session>
    // ...
  }
  
  // Storage access
  storage: {
    upload(key: string, data: Buffer): Promise<string>
    download(key: string): Promise<Buffer>
    // ...
  }
  
  // Cache access
  cache: {
    get(key: string): Promise<any>
    set(key: string, value: any, ttl?: number): Promise<void>
    // ...
  }
  
  // Workflow access
  workflows: {
    trigger(name: string, context: any): Promise<void>
    // ...
  }
  
  // Blueprint access (read-only)
  blueprint: Blueprint
  
  // Emit events
  emit(event: string, data: any): void
  on(event: string, handler: Function): void
}
```

---

## 7. Provider Adapters

### Adapter Interface

```typescript
interface ProviderAdapter {
  name: string
  
  // Deploy Blueprint + Engine + Plugins
  deploy(options: DeployOptions): Promise<DeploymentResult>
  
  // Provider capabilities
  capabilities: {
    database: 'sqlite' | 'postgres' | 'mysql'
    storage: 'local' | 'r2' | 's3' | 'gcs'
    queue: 'memory' | 'redis' | 'sqs'
    edge: boolean
  }
  
  // Generate provider-specific config
  generateConfig(blueprint: Blueprint): ProviderConfig
}
```

### Deployment Artifact

```bash
# What gets deployed:
deployment/
├── blueprint.json       # The application definition
├── plugins/            # Installed plugins
│   ├── @mycompany/
│   └── local-plugins/
├── .env               # Environment variables
└── Zebric-engine         # The runtime engine binary/container
```

**No generated code files** - just Blueprint + Engine + Plugins

---

## 8. Deployment Model

### Local Development

```bash
# Run engine with Blueprint
zebric dev

# Engine:
# 1. Loads blueprint.json
# 2. Loads plugins from ./plugins + node_modules
# 3. Starts HTTP server
# 4. Watches blueprint.json for changes
# 5. Hot-reloads when changed
```

### Production Deployment

```bash
# Build deployable artifact
zebric deploy --provider=cloudflare

# Creates:
deployment/
├── blueprint.json
├── plugins/
├── .env.production
└── wrangler.toml  # Provider-specific config
```

### How Providers Deploy

**Cloudflare**:
- Worker script = Zebric Engine runtime
- D1 database = Entity storage
- R2 = File uploads
- Durable Objects = Workflow state
- Blueprint JSON embedded in Worker

**Vercel**:
- Edge Function = Zebric Engine runtime
- Vercel Postgres = Entity storage
- Vercel Blob = File uploads
- Blueprint JSON embedded in function

**Railway**:
- Docker container = Zebric Engine runtime
- Postgres service = Entity storage
- S3-compatible = File uploads
- BullMQ = Workflows
- Blueprint JSON in container

### Horizontal Scaling

All instances run same Blueprint:
```
Load Balancer
    ↓
┌─────────────┬─────────────┬─────────────┐
│ Engine 1    │ Engine 2    │ Engine 3    │
│ Blueprint   │ Blueprint   │ Blueprint   │
│ + Plugins   │ + Plugins   │ + Plugins   │
└─────────────┴─────────────┴─────────────┘
         ↓           ↓           ↓
      Shared Database + Queue + Storage
```

---

## 9. Migration System

### Runtime Migration

```typescript
// Engine handles migrations at startup/reload

class MigrationRunner {
  async migrate(oldBlueprint: Blueprint | null, newBlueprint: Blueprint) {
    // 1. Diff schemas
    const diff = this.differ.diff(oldBlueprint, newBlueprint)
    
    // 2. Generate SQL (not code files)
    const sql = this.generator.generateSQL(diff)
    
    // 3. Apply to database
    await this.db.transaction(async (tx) => {
      for (const statement of sql) {
        await tx.execute(statement)
      }
    })
    
    // 4. No code generation step!
  }
}
```

### Safe Migrations

```toml
# Safe: Add nullable field
[entity.User]
fields = [
  # existing fields...
  { name = "phone", type = "Text", nullable = true }  # ✅ Safe
]

# Dangerous: Drop field
[entity.User]
fields = [
  # { name = "oldField", type = "Text" }  # ❌ Dangerous
]
```

Engine prompts for confirmation on dangerous migrations.

---

## 10. Conformance Suite

### Test Categories

1. **Runtime Interpretation**: Engine correctly interprets Blueprint
2. **Hot Reload**: Blueprint changes applied without restart
3. **Plugin Loading**: Plugins load and execute correctly
4. **CRUD Operations**: Entity operations work
5. **Auth & Permissions**: Security enforced at runtime
6. **Workflows**: Background jobs execute
7. **UI Rendering**: Pages render from Blueprint

### Example Test

```typescript
test('engine interprets Blueprint at runtime', async () => {
  const engine = new RuntimeEngine()
  
  // Load blueprint
  await engine.load(blueprint)
  await engine.start(3000)
  
  // Make request
  const response = await fetch('http://localhost:3000/api/posts')
  expect(response.status).toBe(200)
  
  // Update blueprint (no restart needed)
  const newBlueprint = {
    ...blueprint,
    entities: [...blueprint.entities, newEntity]
  }
  await engine.reload(newBlueprint)
  
  // New entity immediately available
  const response2 = await fetch('http://localhost:3000/api/comments')
  expect(response2.status).toBe(200)
})
```

---

## Benefits of Runtime Architecture

1. **AI can iterate infinitely** - No code to maintain, just Blueprint
2. **Hot reload everything** - Change Blueprint, engine reacts instantly
3. **No code drift** - Blueprint is always source of truth
4. **Plugins for customization** - Extend without ejecting
5. **Engine improvements benefit all** - Update engine, all apps improve
6. **True multi-engine** - Same Blueprint, different engines
7. **Simpler deployment** - Just Blueprint + Engine, no build artifacts

---

**End of Zebric Framework Specification v0.1 - Runtime Architecture**

This specification defines Zebric as a pure runtime framework where Blueprints are interpreted, not compiled. No code generation occurs - the engine interprets everything at runtime and plugins provide extensibility.
