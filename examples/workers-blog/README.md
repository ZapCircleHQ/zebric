# Zebric Workers Blog Example

This example demonstrates how to run Zebric on CloudFlare Workers with:
- **D1** for the database
- **KV** for caching
- **R2** for file storage (optional)

## Prerequisites

- Node.js 18+
- CloudFlare account
- Wrangler CLI installed globally (`npm install -g wrangler`)

## Setup

1. **Authenticate with CloudFlare**:
   ```bash
   wrangler login
   ```

2. **Create D1 Database**:
   ```bash
   wrangler d1 create blog-db
   ```

   Copy the `database_id` from the output and update `wrangler.toml`.

3. **Create KV Namespace**:
   ```bash
   wrangler kv:namespace create CACHE
   ```

   Copy the `id` from the output and update `wrangler.toml`.

4. **Create R2 Bucket** (optional):
   ```bash
   wrangler r2 bucket create blog-storage
   ```

5. **Run Database Migrations**:
   ```bash
   pnpm db:migrate
   ```

## Development

Start the local development server:

```bash
pnpm dev
```

The blog will be available at `http://localhost:8787`

## API Endpoints

- `GET /api/post` - List all published posts
- `GET /api/post/:id` - Get a single post
- `POST /api/post` - Create a new post (requires authentication)
- `PUT /api/post/:id` - Update a post (requires authentication)
- `DELETE /api/post/:id` - Delete a post (requires authentication)
- `GET /api/comment?postId=:id` - List comments for a post
- `POST /api/comment` - Create a new comment

## Pages

- `/` - Blog home (list of posts)
- `/posts/:slug` - Individual post page with comments

## Deployment

Deploy to CloudFlare Workers:

```bash
pnpm deploy
```

## Architecture

This example uses the `@zebric/runtime-worker` package which provides:

- **D1Adapter**: Implements the StoragePort interface using CloudFlare D1
- **KVCache**: Implements the CacheInterface using CloudFlare KV
- **R2Storage**: File storage adapter for CloudFlare R2
- **ZebricWorkersEngine**: Main engine that handles HTTP requests

All platform-specific implementations conform to the port interfaces defined in `@zebric/runtime-core`, making the blueprint 100% portable across platforms.

## Learn More

- [CloudFlare Workers Docs](https://developers.cloudflare.com/workers/)
- [D1 Database Docs](https://developers.cloudflare.com/d1/)
- [KV Storage Docs](https://developers.cloudflare.com/kv/)
- [R2 Storage Docs](https://developers.cloudflare.com/r2/)
