# Database & Storage Support

Zebric's adapters vary by runtime. Use this page to understand what's available before choosing a deployment target.

## Database

| Database | Node.js (`@zebric/runtime-node`) | CloudFlare Workers (`@zebric/runtime-worker`) |
|----------|----------------------------------|------------------------------------------------|
| SQLite | ✅ Fully supported (default) | — |
| PostgreSQL | ⚠️ Beta — connection and schema generation work; not all field types tested at scale | — |
| CloudFlare D1 | — | ✅ Fully supported |
| MySQL | ❌ Not yet supported | — |

### SQLite (Node.js)

Default for local development and small deployments. Zero configuration required.

```toml
[database]
type = "sqlite"
filename = "./data/app.db"
```

### PostgreSQL (Node.js)

Connects via a connection URL. Schema migrations run automatically on startup.

```toml
[database]
type = "postgres"
url = "postgresql://user:password@localhost:5432/mydb"
```

**Known limitations in beta:**
- Large-scale relationship queries are not yet tested
- `MySQL`-style enum columns behave differently; prefer `Text` fields with validation rules

### CloudFlare D1 (Workers)

Configured via `wrangler.toml` bindings — no blueprint configuration needed. Migrations run automatically.

```toml
# wrangler.toml
[[d1_databases]]
binding = "DB"
database_id = "your-database-id"
```

---

## Cache

| Adapter | Node.js | CloudFlare Workers |
|---------|---------|-------------------|
| In-memory | ✅ Default (dev only — not shared across processes) | — |
| Redis | ✅ Fully supported | — |
| CloudFlare KV | — | ✅ Fully supported |

### Redis (Node.js)

```toml
[cache]
type = "redis"
url = "redis://localhost:6379"
```

### CloudFlare KV (Workers)

Configured via `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE_KV"
id = "your-kv-namespace-id"
```

---

## File Storage

| Adapter | Node.js | CloudFlare Workers |
|---------|---------|-------------------|
| Local disk | ✅ Fully supported | — |
| AWS S3 / S3-compatible | ⚠️ Planned — config fields accepted, not yet implemented | — |
| CloudFlare R2 | — | ✅ Fully supported |

### Local disk (Node.js)

```toml
[storage]
type = "local"
path = "./uploads"
```

### CloudFlare R2 (Workers)

Configured via `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "FILES_R2"
bucket_name = "your-bucket"
```

---

## Choosing a Runtime

| Scenario | Recommended runtime |
|----------|-------------------|
| Local dev / prototyping | Node.js + SQLite |
| Self-hosted production | Node.js + PostgreSQL + Redis |
| Edge / global low-latency | CloudFlare Workers + D1 + KV + R2 |

Full deployment guides at [docs.zebric.dev](https://docs.zebric.dev).
