# @zebric/mcp-apps

Declarative [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) views for Zebric's Agent API. Declare a table or detail view in your Blueprint, then register it on an existing `@zebric/mcp-server` transport. MCP Apps hosts render the HTML resource in their sandbox and deliver tool results to it. Text-only clients keep the existing tool response.

```sh
pnpm add @zebric/mcp-apps @zebric/mcp-server
```

For setup, regression commands, host configurations, and expected results across local Node, stdio, VS Code, Claude, ChatGPT, and Workers/Hono, see the [testing guide](https://docs.zebric.dev/building/mcp-apps-testing/). It distinguishes protocol checks from visual host checks and includes troubleshooting.

## Declare views

```toml
[[mcp_apps]]
name = "tasks"
title = "Tasks"
operation = "task_tracker_list_tasks" # Exact OpenAPI operationId from /api/openapi.json
layout = "table"
fields = ["title", { field = "status", label = "Status" }]
empty = "No tasks found."
resource_uri = "ui://tasks/list-v1.html" # Optional; default: ui://zebric/tasks.html
```

`layout` supports `table` and `detail`. `fields` accepts field names or `{ field, label }` objects; omit it to use the first record's keys. `data_path` and fields accept dot-separated paths. Views consume the operation's result, so use its actual response shape. Names, operation IDs, and resource URIs must be unique within the declarations. Blueprint JSON, TOML arrays, and imported TOML fragments preserve and validate `mcp_apps`.

## Register with a transport

Pass your loaded Blueprint declarations to `createMcpAppsExtension`. For example, after loading `blueprint` with `BlueprintLoader` from `@zebric/runtime-node`:

```ts
import { startZebricMcpHttpServer } from '@zebric/mcp-server/node'
import { createMcpAppsExtension } from '@zebric/mcp-apps'

const server = await startZebricMcpHttpServer({
  applicationUrl: 'http://127.0.0.1:3000',
  credential: () => process.env.ZEBRIC_API_KEY,
  configureServer: createMcpAppsExtension(blueprint.mcp_apps ?? []),
  // Bind address defaults to loopback. For a public listener, configure
  // authorize or authenticate at your gateway as described by mcp-server.
})
```

The same option works with `createZebricMcpServer` for stdio and `createZebricMcpHttpHandler` for Workers/Hono. There is no Node-only import in this package. HTTP authentication, origin/host checks, body limits, discovery caching, and per-request credentials remain those of `@zebric/mcp-server`.

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createZebricMcpServer } from '@zebric/mcp-server'
import { createMcpAppsExtension } from '@zebric/mcp-apps'

const server = await createZebricMcpServer({
  applicationUrl: 'http://127.0.0.1:3000',
  credential: () => process.env.ZEBRIC_API_KEY,
  configureServer: createMcpAppsExtension(blueprint.mcp_apps ?? []),
})
await server.connect(new StdioServerTransport())
```

Only explicitly configured views are registered. A missing or disabled operation fails server creation with a clear error. Views do not enable mutations: `allowedMutations` must still allow each mutation operation separately. To compose an existing configuration hook, call both hooks from an async `configureServer(server, context)` function.

## View behavior

Tools advertise `_meta.ui.resourceUri`. Read tools use `model` and `app` visibility so the view can refresh them; mutation tools use `model` only, so the view can never call them. Resources use `text/html;profile=mcp-app`, contain self-contained HTML/CSS/JavaScript, and declare no external network or resource domains. The client performs the MCP Apps `2026-01-26` lifecycle handshake, renders tool results, follows host theme variables, and reports its height.

Refresh appears when the bound operation is read-only and the host supports server tool calls. It repeats the original arguments through the host's `tools/call` bridge. Mutation result views have no refresh action. Views use `textContent` for result values and do not embed API credentials or initial records in cacheable resources.

This version provides result tables and details. It does not embed existing Zebric pages or provide forms, board interactions, custom HTML templates, or an MCP Apps host. Use an MCP Apps capable client to display the views. Registration is programmatic; the existing `zebric-mcp-server` CLI does not load view declarations. Change `resource_uri` when deploying a changed view if your host caches resources by URI.

## Repository example

The Task Tracker Blueprint includes a task table declaration. Start and seed `examples/task-tracker` following its README, then, from the repository root after building the packages, run:

```sh
TASK_TRACKER_API_KEY=your-key node packages/mcp-apps/examples/task-tracker.mjs
```

Connect an MCP Apps client to `http://127.0.0.1:3001/mcp` and invoke `task_tracker_list_tasks`. The example exposes reads; the existing Task Tracker mutation example remains available separately.
