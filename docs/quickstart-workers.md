# Zebric Quickstart for CloudFlare Workers

Get from idea to a running Zebric application on CloudFlare's global edge network in minutes by pairing an LLM-generated `blueprint.toml` with the Zebric Workers runtime.

## Prerequisites

- Node.js 20 or newer
- `pnpm` 8.x
- CloudFlare account (free tier works great)
- Wrangler CLI: `pnpm install -g wrangler`
- Access to an LLM that can follow structured prompts (ChatGPT, Claude, Gemini, etc.)

## 1. Prompt an LLM to Generate `blueprint.toml`

Start the conversation by pasting the following prompt. Adjust the app description as needed:

```
You are an expert Zebric Blueprint author. Produce a complete `blueprint.toml`
for a {describe your app here} that will run on CloudFlare Workers.

Requirements:
- Follow the Zebric Blueprint specification
- Define entities with realistic field names and data types
- Include at least one page per major workflow
- For custom HTML layouts, add a template configuration with engine and source
- Use inline templates (type = "inline") for Workers deployment
- Use `auth = "optional"` where anonymous access is acceptable
- Include helpful comments sparingly
- Return only valid TOML

Note: CloudFlare Workers has some differences from Node.js:
- Prefer inline templates over file templates for better performance
- Keep templates compact for faster edge execution
- Use Liquid templates (default) for the best balance of bundle size and security; Handlebars works too if needed
```

Tips while iterating with the LLM:

- Ask it to refine entities or page flows rather than rewriting from scratch.
- Have it add relationships with `where` clauses (`[page."/tasks/:id".queries.task]` patterns).
- Request inline templates for Workers to avoid KV storage setup.
- For complex templates, you can still use KV storage with file-based templates.

## 2. Set Up Your Workers Project

### Initialize Project

```bash
# Create a new directory
mkdir my-zebric-app
cd my-zebric-app

# Initialize a Workers project
wrangler init

# Install Zebric runtime for Workers
pnpm add @zebric/runtime-worker
```

### Create Blueprint

1. Paste the generated TOML into `blueprint.toml`.
2. Run validation:
   ```bash
   pnpm exec zbl validate --blueprint=blueprint.toml
   ```

## 3. Create Your Worker Entry Point

Create `src/index.ts`:

```typescript
import { createWorkerHandler } from '@zebric/runtime-worker'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load Blueprint at build time
const blueprintContent = readFileSync(
  resolve(__dirname, '../blueprint.toml'),
  'utf-8'
)

export interface Env {
  DB: D1Database        // D1 database binding
  SESSIONS: KVNamespace // KV for sessions
  FILES?: R2Bucket      // R2 for file uploads (optional)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const handler = createWorkerHandler({
      blueprintContent,
      db: env.DB,
      sessions: env.SESSIONS,
      storage: env.FILES,
    })

    return handler.fetch(request)
  }
}
```

## 4. Configure Wrangler

Update `wrangler.toml`:

```toml
name = "my-zebric-app"
main = "src/index.ts"
compatibility_date = "2025-01-09"
compatibility_flags = ["formdata_parser_supports_files"]
node_compat = true

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "my-zebric-db"
database_id = "your-database-id"  # Created in step 5

# KV for Sessions
[[kv_namespaces]]
binding = "SESSIONS"
id = "your-kv-namespace-id"  # Created in step 5

# R2 for File Uploads (optional)
[[r2_buckets]]
binding = "FILES"
bucket_name = "my-zebric-files"  # Created in step 6 if needed
```

## 5. Create CloudFlare Resources

### Create D1 Database

```bash
# Create the database
wrangler d1 create my-zebric-db

# Copy the database_id from output and update wrangler.toml
```

The Zebric runtime will automatically create tables based on your Blueprint entities on first request.

### Create KV Namespace for Sessions

```bash
# Create KV namespace
wrangler kv:namespace create SESSIONS

# Copy the id from output and update wrangler.toml
```

### Create R2 Bucket (Optional - for file uploads)

If your Blueprint includes file upload fields:

```bash
# Create R2 bucket
wrangler r2 bucket create my-zebric-files

# Update wrangler.toml with the bucket name
```

## 6. Deploy to Workers

```bash
# Deploy to CloudFlare Workers
wrangler deploy

# Your app is now live at: https://my-zebric-app.your-subdomain.workers.dev
```

## 7. Test Your Application

Visit your Workers URL:

```bash
# Open in browser
open https://my-zebric-app.your-subdomain.workers.dev

# Or test with curl
curl https://my-zebric-app.your-subdomain.workers.dev/api/posts
```

## 8. Custom Templates on Workers

### Using Inline Templates (Recommended)

Inline templates are bundled with your Worker for maximum performance:

```toml
[page."/products"]
title = "Products"
layout = "custom"

[page."/products".template]
engine = "liquid"
type = "inline"
source = """
<div class="products">
  <h1>{{ page.title }}</h1>
  {% for p in data.products %}
    <div class="product">
      <h2>{{ p.name }}</h2>
      <p>${{ p.price }}</p>
    </div>
  {% endfor %}
</div>
"""

[page."/products".queries.products]
entity = "Product"
orderBy = { name = "asc" }
```

### Using Handlebars with Inline Templates

Install Handlebars:

```bash
pnpm add handlebars
```

Update your worker to register the Handlebars engine:

```typescript
import { createWorkerHandler, HandlebarsEngine } from '@zebric/runtime-worker'
import Handlebars from 'handlebars'

const handler = createWorkerHandler({
  blueprintContent,
  db: env.DB,
  sessions: env.SESSIONS,
  // Register Handlebars engine
  templateEngines: [
    new HandlebarsEngine(Handlebars)
  ]
})
```

Blueprint with inline Handlebars template:

```toml
[page."/products"]
title = "Products"
layout = "custom"

[page."/products".template]
engine = "handlebars"
type = "inline"
source = """
<div class="products">
  <h1>{{page.title}}</h1>
  {{#each data.products}}
    <div class="product">
      <h2>{{this.name}}</h2>
      <p>${{this.price}}</p>
    </div>
  {{/each}}
</div>
"""

[page."/products".queries.products]
entity = "Product"
orderBy = { name = "asc" }
```

### Using KV Storage for Templates (Advanced)

For larger templates, store them in KV:

```bash
# Create KV namespace for templates
wrangler kv:namespace create TEMPLATES

# Upload template
wrangler kv:key put --namespace-id=your-templates-kv-id \
  "template:products.hbs" --path=./templates/products.hbs
```

Update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TEMPLATES"
id = "your-templates-kv-id"
```

Update worker:

```typescript
import { KVTemplateLoader } from '@zebric/runtime-worker'

const handler = createWorkerHandler({
  blueprintContent,
  db: env.DB,
  sessions: env.SESSIONS,
  templateLoader: new KVTemplateLoader({
    kv: env.TEMPLATES,
    keyPrefix: 'template:'
  })
})
```

Blueprint with KV template:

```toml
[page."/products"]
title = "Products"
layout = "custom"

[page."/products".template]
engine = "handlebars"
type = "file"
source = "products.hbs"  # Loaded from KV with key "template:products.hbs"
```

## 9. Custom Behaviors on Workers

CloudFlare Workers doesn't support dynamic code execution like Node.js's `vm` module. Instead, behaviors must be **bundled at build time**.

### Behaviors vs Templates

**For rendering HTML**: Use [custom templates](#8-custom-templates-on-workers) instead of behaviors.

**For event handlers and complex logic**: Use bundled behavior functions.

### Creating Behavior Functions

Create a behavior file (`behaviors/render-tasks.ts`):

```typescript
import type { BehaviorContext } from '@zebric/runtime-worker'

export default function renderTasks(context: BehaviorContext): string {
  const { data, helpers } = context
  const tasks = data.tasks || []

  return `
    <div class="tasks">
      ${tasks.map((task: any) => `
        <div class="task">
          <h3>${helpers.escapeHtml(task.title)}</h3>
          <p>Due: ${helpers.formatDate(task.dueDate)}</p>
        </div>
      `).join('')}
    </div>
  `
}
```

### Registering Behaviors

Update your worker entry point (`src/index.ts`):

```typescript
import { createWorkerHandler, BehaviorRegistry } from '@zebric/runtime-worker'
import renderTasks from '../behaviors/render-tasks'
import onStatusClick from '../behaviors/on-status-click'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const behaviors = new BehaviorRegistry({
      'behaviors/render-tasks.js': renderTasks,
      'behaviors/on-status-click.js': onStatusClick,
    })

    const handler = createWorkerHandler({
      blueprintContent,
      db: env.DB,
      sessions: env.SESSIONS,
      behaviors,
    })

    return handler.fetch(request)
  }
}
```

### Blueprint Configuration

Reference behaviors in your Blueprint:

```toml
[page."/tasks"]
title = "My Tasks"
layout = "custom"

[page."/tasks".behavior]
render = "behaviors/render-tasks.js"

[page."/tasks".queries.tasks]
entity = "Task"
where = { userId = "$currentUser.id" }
orderBy = { dueDate = "asc" }
```

### Event Handlers

Create handler for button clicks or form submissions:

```typescript
// behaviors/on-status-click.ts
import type { BehaviorContext } from '@zebric/runtime-worker'

export default async function onStatusClick(context: BehaviorContext) {
  const { params, session } = context

  if (!session) {
    return { error: 'Authentication required' }
  }

  // Return action for the runtime to execute
  return {
    action: 'update',
    entity: 'Task',
    id: params?.id,
    data: {
      status: 'completed',
      completedAt: new Date().toISOString()
    }
  }
}
```

Reference in Blueprint:

```toml
[page."/tasks/:id".behavior]
on_status_click = "behaviors/on-status-click.js"
```

### When to Use Each Approach

| Use Case | Recommended Approach | Why |
|----------|---------------------|-----|
| Rendering HTML | **Custom Templates** | Easier to update, can use KV storage |
| Event Handlers | **Bundled Behaviors** | Type-safe, fast execution |
| Data Transformation | **Bundled Behaviors** | Full JavaScript power |
| Simple Pages | **Built-in Layouts** | No code needed |

## 10. Iterate with the LLM

When you need changes:

1. Copy the relevant section of `blueprint.toml`.
2. Explain what needs changing (e.g., "Add filtering by category to the products page").
3. Ask the LLM to update the Blueprint and template.
4. Update your files and redeploy: `wrangler deploy`

For template-only changes with KV storage:

```bash
# Update template in KV without full deployment
wrangler kv:key put --namespace-id=your-templates-kv-id \
  "template:products.hbs" --path=./templates/products.hbs
```

## 10. Development Workflow

### Local Development

```bash
# Run locally with Wrangler
wrangler dev

# Your app runs at http://localhost:8787
```

This uses local D1, KV, and R2 emulation for fast development.

### View Logs

```bash
# Tail production logs
wrangler tail

# View logs in CloudFlare dashboard
# https://dash.cloudflare.com -> Workers & Pages -> Your Worker -> Logs
```

## Performance Best Practices for Workers

1. **Use Inline Templates**: Bundle templates with your Worker for zero-latency access
2. **Keep Templates Small**: Workers have a 1MB bundle size limit
3. **Use Native Engine**: JavaScript template literals are fastest and smallest
4. **Cache Aggressively**: KV has automatic caching, use it for templates
5. **Minimize Dependencies**: Each dependency increases bundle size

## CloudFlare-Specific Features

### Geographic Performance

Your app runs on 300+ edge locations worldwide. Users get sub-50ms response times globally.

### Cost Efficiency

CloudFlare Workers free tier includes:
- 100,000 requests/day
- D1: 5GB storage, 5M rows read/day
- KV: 100,000 reads/day, 1,000 writes/day
- R2: 10GB storage, 1M Class A operations/month

Perfect for MVPs and small-to-medium applications.

### Security

- Automatic DDoS protection
- Built-in SSL/TLS
- CSRF protection included in Zebric runtime
- Session management with KV storage

## Next Steps

- Explore [CloudFlare Workers documentation](https://developers.cloudflare.com/workers/)
- Learn about [D1 Database](https://developers.cloudflare.com/d1/) for SQL storage
- Read about [KV Storage](https://developers.cloudflare.com/kv/) for key-value data
- Understand [R2 Storage](https://developers.cloudflare.com/r2/) for files
- Check out [Custom Templates](blueprint-specification.md#custom-templates) for advanced layouts
- Set up a custom domain for your Worker

You're now ready to build and deploy Zebric apps on CloudFlare's global edge network! 🚀
