# Zebric CloudFlare Workers Starter

The simplest way to deploy a full-stack web application to CloudFlare Workers.

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Create Database

```bash
# Create a new D1 database
pnpm db:create

# Copy the database_id from the output and update wrangler.toml
```

Update `wrangler.toml` with your database ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "zebric-db"
database_id = "YOUR-DATABASE-ID-HERE"  # Replace with your ID
```

### 3. Run Database Migrations

```bash
# Apply migrations locally
pnpm db:migrate
```

### 4. Start Development Server

```bash
pnpm dev
```

Visit http://localhost:8787

### 5. Deploy to Production

```bash
# Apply migrations to production
pnpm db:migrate:prod

# Deploy
pnpm run deploy
```

## Customizing Your App

### Change the Blueprint

Edit `blueprint.toml` to define your data models and pages. That's it!

**Example: Add a new field to Task**

```toml
[[entities.fields]]
name = "assignee"
type = "string"
```

**Example: Add a new page**

```toml
[[pages]]
path = "/tasks/completed"
title = "Completed Tasks"
layout = "list"
entity = "Task"

[[pages.query]]
entity = "Task"
where = { status = "completed" }
```

### Update Database Schema

After changing entities in `blueprint.toml`, create a migration:

1. Create a new migration file in `migrations/` (e.g., `0002_add_assignee.sql`)
2. Run the migration:

```bash
# Local
pnpm db:migrate

# Production
pnpm db:migrate:prod
```

## Project Structure

```
.
├── worker.ts           # Entry point (don't change this)
├── blueprint.toml      # Your app definition (change this!)
├── wrangler.toml       # CloudFlare configuration
├── package.json        # Dependencies
└── migrations/         # Database migrations
    └── 0001_initial.sql
```

## Available Layouts

- `dashboard` - Dashboard view with stats
- `list` - Table view with search and filters
- `detail` - Single item detail view
- `form` - Create/edit form

## Available Field Types

- `string` - Short text (VARCHAR)
- `text` - Long text (TEXT)
- `integer` - Whole numbers
- `float` - Decimal numbers
- `boolean` - true/false
- `date` - Date only (YYYY-MM-DD)
- `datetime` - Date and time
- `json` - JSON data

## Query Operators

Use in `where` clauses:

- `{ field = "value" }` - Equals
- `{ field = { $ne = "value" } }` - Not equals
- `{ field = { $gt = 5 } }` - Greater than
- `{ field = { $gte = 5 } }` - Greater than or equal
- `{ field = { $lt = 5 } }` - Less than
- `{ field = { $lte = 5 } }` - Less than or equal
- `{ field = { $in = ["a", "b"] } }` - In array
- `{ field = { $like = "%search%" } }` - Pattern match
- `{ field = { $null = true } }` - Is null

## Optional Features

### Enable Sessions (for forms with CSRF protection)

1. Create KV namespace:

```bash
wrangler kv:namespace create SESSION_KV
```

2. Uncomment in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SESSION_KV"
id = "your-session-kv-id"
```

### Enable Caching

1. Create KV namespace:

```bash
wrangler kv:namespace create CACHE_KV
```

2. Uncomment in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE_KV"
id = "your-cache-kv-id"
```

### Enable File Storage

1. Create R2 bucket:

```bash
wrangler r2 bucket create zebric-files
```

2. Uncomment in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "FILES_R2"
bucket_name = "zebric-files"
```

## API Access

All pages are available as JSON APIs by setting the `Accept` header:

```bash
# Get HTML
curl http://localhost:8787/tasks

# Get JSON
curl -H "Accept: application/json" http://localhost:8787/tasks
```

## Learn More

- [Zebric Documentation](https://github.com/zapcirclehq/zebric)
- [CloudFlare Workers Docs](https://developers.cloudflare.com/workers/)
- [D1 Database Docs](https://developers.cloudflare.com/d1/)

## Support

- GitHub Issues: https://github.com/zapcirclehq/zebric/issues

---

Built with [Zebric](https://github.com/zapcirclehq/zebric) - Full-stack applications from a single file.
