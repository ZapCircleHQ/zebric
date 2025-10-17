# Zebric Runtime Engine v0.1
## Overview & Architecture

---

## 1. Overview

### What is the Runtime Engine?

A **pure interpreter** that loads Blueprint TOML or JSON and executes application logic at runtime. Zero code generation. Server-renders HTML by default. Fully plugin-extensible.

### Core Philosophy

**Server-First Rendering**:
- Complete HTML pages rendered on server
- View Transitions API for smooth navigation  
- No React unless explicitly opted-in
- Progressive enhancement with Alpine.js or HTMX (planned)
- Feels like SPA, performs better

**No Code Generation**:
- Blueprint TOML or JSON is loaded into memory
- Routes are matched at runtime
- Queries are built and executed at runtime
- HTML is rendered from Blueprint definitions
- Zero generated code files

**Plugin-First**:
- Custom behavior = write plugins
- Custom UI = theme plugins
- Custom integrations = integration plugins
- Plugins have full engine API access

**Hot-Reload Everything**:
- Blueprint changes → instant reload
- Migrations run automatically
- No server restart needed
- Existing connections continue working

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Node.js 20+ | JavaScript runtime |
| **Language** | TypeScript | Type safety |
| **HTTP** | Fastify 5.x | Fast HTTP server |
| **Renderer** | Server-side HTML | No React by default |
| **Templating** | Tagged templates | Fast HTML generation |
| **Database** | Drizzle ORM | Runtime query building |
| **DB (dev)** | SQLite | Local development |
| **DB (prod)** | PostgreSQL | Production database |
| **Queue** | BullMQ | Background jobs |
| **Cache** | Redis | Job queue + caching |
| **Auth** | Better Auth 5.x | Session management |
| **Styling** | Tailwind 3.x | Utility CSS (via CDN) |
| **Enhancement** | Alpine.js (optional, planned) | Progressive interactivity |
| **Enhancement** | HTMX (optional, planned) | Server-driven interactivity |

**Key Architecture**: Server renders HTML, uses View Transitions API for smooth navigation. No build step. No React unless explicitly opted-in via plugin.

---

## 2. Runtime Architecture

### High-Level Flow

```
┌──────────────────────────────────────────────┐
│  1. Engine Starts                            │
│     - Load blueprint.toml (or JSON)          │
│     - Load plugins from ./plugins + npm      │
│     - Initialize database                    │
│     - Initialize HTML renderer + theme       │
│     - Start HTTP server                      │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│  2. Request Arrives (GET /posts)             │
│     - Match route (runtime lookup)           │
│     - Check auth (runtime evaluation)        │
│     - Check permissions (runtime check)      │
│     - Execute queries (runtime SQL building) │
│     - Render HTML (server-side)              │
│     - Send complete page                     │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│  3. Blueprint Changes Detected               │
│     - Detect file change                     │
│     - Validate new blueprint                 │
│     - Run migrations (if schema changed)     │
│     - Hot-reload in-memory state             │
│     - Continue serving requests              │
└──────────────────────────────────────────────┘
```

### Request Handling Flow

```
HTTP GET /posts
    ↓
┌─────────────────────────────────┐
│ Route Matcher                   │  Find page definition in Blueprint
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Auth Check                      │  Verify session, load user
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Permission Check                │  Evaluate RLS rules at runtime
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Query Executor                  │  Build SQL from Blueprint, execute
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ HTML Renderer                   │  Server-render complete HTML page
└─────────────────────────────────┘
    ↓
HTTP Response (200 OK, text/html)
```

### Form Submission Flow

```
HTTP POST /posts/new (with FormData)
    ↓
┌─────────────────────────────────┐
│ Parse & Validate                │  Validate against form definition
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Permission Check                │  Can user create Post?
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Database Insert                 │  Create record
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Trigger Workflows               │  Queue background jobs
└─────────────────────────────────┘
    ↓
HTTP Response (redirect or JSON)
```

### Directory Structure

```
zebric/
├── packages/
│   ├── runtime/                  # Core runtime engine
│   │   ├── src/
│   │   │   ├── engine.ts         # Main Engine class
│   │   │   ├── blueprint/        # Blueprint loader & validator
│   │   │   ├── interpreter/      # Route/query interpreters
│   │   │   ├── renderer/         # HTML renderer (server-side)
│   │   │   │   ├── html.ts       # Core HTML renderer
│   │   │   │   ├── layouts.ts    # List/detail/form layouts
│   │   │   │   └── theme.ts      # Theme system
│   │   │   ├── database/         # Runtime query builder
│   │   │   │   ├── schema.ts     # Generate Drizzle schemas
│   │   │   │   ├── query.ts      # Query executor
│   │   │   │   └── migrate.ts    # Migration runner
│   │   │   ├── auth/             # Auth runtime
│   │   │   │   ├── better-auth.ts      # Better Auth integration
│   │   │   │   ├── providers.ts  # OAuth providers
│   │   │   │   └── permissions.ts # Permission checker
│   │   │   ├── workflows/        # Workflow runtime
│   │   │   │   ├── executor.ts   # Workflow executor
│   │   │   │   ├── queue.ts      # BullMQ setup
│   │   │   │   └── triggers.ts   # Trigger manager
│   │   │   ├── plugins/          # Plugin system
│   │   │   │   ├── registry.ts   # Plugin registry
│   │   │   │   └── loader.ts     # Plugin loader
│   │   │   ├── hot-reload/       # Hot reload system
│   │   │   │   ├── watcher.ts    # File watcher
│   │   │   │   └── handler.ts    # Reload handler
│   │   │   └── server/           # HTTP server
│   │   │       ├── routes.ts     # Route registration
│   │   │       └── middleware.ts # Middleware
│   │   └── package.json
│   │
│   ├── themes/                   # Built-in themes
│   │   ├── default/
│   │   │   ├── theme.ts          # Theme definition
│   │   │   └── custom.css        # Optional custom CSS
│   │   ├── minimal/
│   │   └── dashboard/
│   │
│   ├── cli/                      # CLI tool
│   │   └── src/
│   │       ├── commands/
│   │       │   ├── dev.ts        # Zebric dev
│   │       │   ├── build.ts      # Zebric build (minimal)
│   │       │   ├── deploy.ts     # Zebric deploy
│   │       │   └── plugin.ts     # Zebric plugin
│   │       └── index.ts
│   │
│   └── plugin-sdk/               # Plugin development SDK
│       └── src/
│           ├── types.ts          # TypeScript types
│           ├── helpers.ts        # Helper functions
│           └── html.ts           # HTML template helpers
│
├── plugins/                      # Built-in plugins (planned)
│   ├── auth-google/              # Google OAuth
│   ├── auth-github/              # GitHub OAuth
│   ├── storage-r2/               # Cloudflare R2
│   ├── storage-s3/               # AWS S3
│   ├── email-resend/             # Resend email
│   ├── payment-stripe/           # Stripe payments
│   ├── ui-alpine/                # Alpine.js enhancement
│   ├── ui-htmx/                  # HTMX enhancement
│   └── ui-react/                 # React (opt-in only)
│
├── examples/                     # Example applications
│   ├── blog/
│   │   ├── blueprint.toml        # Blog app definition
│   │   ├── themes/               # Custom CSS
│   │   └── plugins/              # Custom plugins
│   └── saas-starter/
│       ├── blueprint.toml        # SaaS app definition
│       └── plugins/
│
└── tests/
    ├── unit/                     # Unit tests
    ├── integration/              # Integration tests
    └── e2e/                      # End-to-end tests
```

### Deployment Artifact

```
# What gets deployed (no generated code!)
deployment/
├── blueprint.toml          # Application definition
├── plugins/               # Installed plugins
│   ├── @mycompany/custom/
│   └── node_modules/
├── themes/                # Custom themes/CSS
│   └── custom.css
├── .env                   # Environment variables
└── zebric-engine             # Runtime engine (interprets everything)
```

### Component Interaction

```
┌──────────────────────────────────────────────┐
│              Blueprint TOML                   │
│  (Entities, Pages, Workflows, Auth)          │
└──────────────────────────────────────────────┘
         ↓ loaded by ↓
┌──────────────────────────────────────────────┐
│              Engine Core                      │
│  ┌────────────┐  ┌──────────┐               │
│  │  Blueprint │  │  Plugin  │               │
│  │   Loader   │  │ Registry │               │
│  └────────────┘  └──────────┘               │
│         ↓              ↓                      │
│  ┌────────────────────────────────────────┐ │
│  │         Request Handler                │ │
│  │  - Route interpreter                   │ │
│  │  - Auth checker                        │ │
│  │  - Permission evaluator                │ │
│  │  - Query executor                      │ │
│  │  - HTML renderer                       │ │
│  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
         ↓ uses ↓
┌──────────────────────────────────────────────┐
│           Infrastructure                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Database │  │  Queue   │  │  Cache   │  │
│  │ (Drizzle)│  │ (BullMQ) │  │ (Redis)  │  │
│  └──────────┘  └──────────┘  └──────────┘  │
└──────────────────────────────────────────────┘
```

---

## 3. Key Architectural Decisions

### Decision 1: Server-First Rendering

**Why**: 
- Simpler for AI to generate (TOML → HTML vs TOML → React)
- Faster for users (no JS bundle, no hydration)
- Better SEO (real HTML immediately)
- View Transitions API makes it feel like SPA
- Progressive enhancement when needed

**How**:
- Engine renders complete HTML on server
- Minimal client JS (~2KB for forms)
- Optional Alpine.js (~15KB) or HTMX (~14KB)
- React available via plugin for complex cases

### Decision 2: Runtime Interpretation

**Why**:
- AI can iterate infinitely (no code drift)
- Hot reload everything instantly
- Single source of truth (Blueprint)
- Engines in any language can interpret same Blueprint

**Trade-offs**:
- ~5ms runtime overhead per request (acceptable)
- More complex engine (but users don't see this)
- Plugin system instead of "just write code"

### Decision 3: Plugin-Based Extensibility

**Why**:
- Clear extension points
- No code ejection needed
- Composable functionality

**How**:
- Plugins register capabilities explicitly
- TypeScript types for safety
- Sandboxed execution
- Performance monitoring

### Decision 4: No Build Step

**Why**:
- Faster development (change → see result)
- Simpler deployment (Blueprint + Engine)
- No webpack/vite complexity
- Works great for server-rendered HTML

**Exception**:
- React plugin requires build (but it's opt-in)
- Production can precompile Tailwind CSS

---

## 4. Performance Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| **Cold start** | < 1s | Lazy load plugins, cache routes |
| **Hot reload** | < 500ms | In-memory swap, minimal disruption |
| **Page render** | < 100ms | Route cache, query cache |
| **Form submit** | < 200ms | Optimistic UI, async workflows |
| **Bundle size** | < 20KB | Server-rendered, minimal client JS |
| **Time to interactive** | < 500ms | No hydration, immediate |

### Comparison: SPA vs Server-Rendered

**Traditional React SPA**:
```
Request → Shell (5KB HTML) → JS Bundle (200KB) → Hydrate → Fetch Data → Render
Total: 2-3 seconds to interactive
```

**Zebric Server-Rendered**:
```
Request → Complete HTML with Data (20KB) → Optional Alpine.js (15KB) → Interactive
Total: 300-500ms to interactive
```

**3-6x faster** for most use cases.

---

## 5. Development Workflow

### Local Development

```bash
# Start engine with hot reload
zebric dev

# Engine:
# 1. Loads blueprint.json
# 2. Loads plugins
# 3. Initializes renderer + theme
# 4. Starts HTTP server at :3000
# 5. Watches for Blueprint changes
```

### Making Changes

```bash
# Edit Blueprint
vim blueprint.json

# Engine automatically:
# 1. Detects change
# 2. Validates new Blueprint
# 3. Runs migrations (if needed)
# 4. Reloads in-memory state
# 5. Continues serving (no restart!)

# See changes immediately at localhost:3000
```

### Adding Plugins (Example)

```bash
# Install plugin
npm install @zebric/plugin-stripe

# Add to Blueprint
[plugin."@zebric/plugin-stripe"]
enabled = true
config = { secretKey = "${STRIPE_SECRET_KEY}" }

# Engine auto-loads plugin on next reload
```

---

## 6. Production Deployment

### Build (Minimal)

```bash
zebric build

# Creates:
dist/
├── blueprint.json      # Validated Blueprint
├── plugins/           # Installed plugins
└── themes/            # Compiled CSS (optional)
```

### Deploy to Railway

```bash
zebric deploy --provider=railway

# Deploys:
# - Blueprint JSON
# - Engine runtime (Docker container)
# - Plugins
# - Environment config
```

### Horizontal Scaling

```
        Load Balancer
             ↓
    ┌────────┼────────┐
    ↓        ↓        ↓
┌────────┬────────┬────────┐
│Engine 1│Engine 2│Engine 3│  All run same Blueprint
│+ Plugins + Plugins + Plugins│
└────────┴────────┴────────┘
         ↓        ↓        ↓
    Shared Database + Queue
```

All instances interpret the same Blueprint - no code to sync.

---

## 7. Why This Architecture Works

### For AI Coding
- Blueprint is simpler than code for AI to generate
- No code drift (Blueprint is always source of truth)
- Infinite iteration possible

### For Developers  
- Declarative > imperative
- Hot reload everything
- Plugin system for customization
- Can drop to code via plugins

### For Users
- Faster page loads
- Better SEO
- Works without JavaScript
- Modern feel with View Transitions

### For Operations
- Simple deployment (Blueprint + Engine)
- Horizontal scaling trivial
- No build artifacts to manage
- Same Blueprint runs anywhere

---

**Next**: See full implementation details in the complete Runtime Engine Specification.