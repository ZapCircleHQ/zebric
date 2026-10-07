# @zebric/mcp-server

Expose a running Zebric application's Agent API as an MCP server over stdio or Streamable HTTP/S. Node supports both transports; Cloudflare Workers use the HTTP handler. With stdio, when the application advertises its authenticated Agent API event stream, the adapter also declares Claude Code's experimental `claude/channel` capability and forwards redacted entity and workflow notifications into the session.

```sh
zebric-mcp-server --connect http://127.0.0.1:3000
```

Bearer authentication can be supplied without placing a credential on the command line:

```sh
ZEBRIC_API_KEY=secret zebric-mcp-server --connect http://127.0.0.1:3000 --credential-env ZEBRIC_API_KEY
```

The server exposes reads by default. Mutations must be opted in by exact OpenAPI operation ID with repeatable `--allow-mutation` options. Zebric's existing HTTP authorization, validation, idempotency, workflow, and audit paths remain authoritative.

## Node HTTP/S

Serve MCP at `http://127.0.0.1:3001/mcp`:

```sh
zebric-mcp-server --connect http://127.0.0.1:3000 --transport http --port 3001
```

Use `--host` to change the bind address. Non-loopback listeners require incoming authentication with `--auth-env`, independently of the upstream application's `--credential-env`. Use `--allow-unauthenticated` only when deliberately exposing a public application or enforcing authentication at a gateway. Enable native HTTPS with a PEM certificate and key, or terminate TLS at your reverse proxy:

```sh
zebric-mcp-server --connect https://app.example.com --transport http \
  --auth-env MCP_TOKEN --credential-env ZEBRIC_API_KEY \
  --tls-cert ./cert.pem --tls-key ./key.pem
```

For programmatic use, import `startZebricMcpHttpServer` or `createZebricMcpNodeHandler` from `@zebric/mcp-server/node`. The handler mounts on existing Node HTTP and HTTPS servers; the starter returns the listening server. Its defaults are host `127.0.0.1`, port `3001`, path `/mcp`. Supply `tls: { cert, key }` for HTTPS and `authorize(request)` for incoming authentication.

## Cloudflare Workers

Import the Web Standard handler from `@zebric/mcp-server/http`:

```ts
import { createZebricMcpHttpHandler } from '@zebric/mcp-server/http'

interface Env {
  APPLICATION_URL: string
  ZEBRIC_API_KEY: string
  MCP_TOKEN: string
}

// Reuse the handler within an isolate for concurrency limits and discovery caching.
const handlers = new WeakMap<Env, ReturnType<typeof createZebricMcpHttpHandler>>()

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    let handler = handlers.get(env)
    if (!handler) {
      handler = createZebricMcpHttpHandler({
        applicationUrl: env.APPLICATION_URL,
        credential: () => env.ZEBRIC_API_KEY,
        authorize: request => Boolean(env.MCP_TOKEN) &&
          request.headers.get('authorization') === `Bearer ${env.MCP_TOKEN}`,
        allowedHosts: ['mcp.example.com'], // Your deployed Worker hostname.
        // allowedMutations: ['tasks_create', 'tasks_update'],
      })
      handlers.set(env, handler)
    }
    return handler(request)
  },
}
```

Configure Wrangler with `compatibility_flags = ["nodejs_compat"]` and a compatibility date of `2024-09-23` or later for the runtime tool factory's crypto imports (see [Cloudflare's compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)). Cloudflare supplies HTTPS. Set authentication credentials as Worker secrets. The handler also mounts on Hono with `app.all('/mcp', c => handler(c.req.raw))`.

HTTP handlers are stateless and use JSON responses, with one MCP server per POST and no session affinity. They support initialization, tool listing and calls; GET and DELETE return 405. Persistent Claude channel events remain a stdio feature. HTTP mutations retain the existing explicit operation allowlist, but in-memory mutation state lasts only for that request.

Origin headers are rejected unless explicitly allowed with `allowedOrigins` (repeatable `--allowed-origin` in the CLI). Local Node listeners also validate Host by default. Set `allowedHosts` when mounting the Node handler yourself. Both mounted handlers require `authorize`, or an explicit `allowUnauthenticated: true` when a gateway authenticates requests or the application is intentionally public. The Node starter permits unauthenticated loopback listeners by default.

HTTP handlers limit bodies to 1,000,000 bytes, including streamed/chunked uploads, and reject larger bodies with 413. Incomplete bodies time out after 15 seconds with 408. They validate headers and JSON-RPC before accessing the application. Each handler permits at most 16 simultaneous requests (503 when full) and caches one discovery contract for 30 seconds, coalescing concurrent discovery. Upstream application authorization remains authoritative during that cache interval.

Configure these limits with `maxRequestBytes`, `requestBodyTimeoutMs`, `maxConcurrentRequests`, and `discoveryCacheTtlMs`. Set the cache TTL to zero to disable reuse. Retain the handler between requests to preserve concurrency accounting and cache reuse; limits are per handler/isolate, so deployment-wide rate limiting belongs at your gateway.
