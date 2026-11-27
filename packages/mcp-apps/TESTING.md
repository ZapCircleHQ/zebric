# Testing MCP Apps

Use this guide from a Zebric repository checkout. Run commands from its root unless a step says otherwise. Start with the protocol checks, then test the UI in a host; a successful tool call alone does not prove that the embedded view works.

## Environment matrix

| Environment | Transport | What to verify |
| --- | --- | --- |
| Local Node on macOS, Linux, or Windows | Streamable HTTP on `127.0.0.1:3001/mcp` | Tool metadata, HTML resources, authentication, and text results |
| MCP Apps reference `basic-host` | Local browser HTTP with the example's `--browser` mode | Sandbox initialization, table/detail rendering, Refresh, resize, console errors |
| VS Code with MCP Apps enabled | Local HTTP or stdio | Tool selection and an interactive result in chat |
| Claude Desktop local server | stdio | Local tool discovery and UI in an MCP Apps capable build |
| Claude remote connector or ChatGPT custom MCP server | Reachable HTTPS or a supported private tunnel | Remote discovery, authentication, tool selection, and UI |
| Cloudflare Workers / Hono | Web Standard Streamable HTTP | Same resource/tool contract, request-scoped credentials, deployed HTTPS behavior |
| A client without MCP Apps UI | Either supported transport | Normal text result; no UI is expected |

These are test targets, not a claim that every client version or deployment has been certified. Record client version, OS, Node version, transport, authentication method, and results. Host support and settings change; the linked official guides below are the source for host setup. No external host accounts are needed for the automated tests.

## 1. Build and run the regression checks

Use Node 24 (the repository's CI version) and the pnpm version in the root `packageManager` field. The packages require Node 22 or newer; use a version also supported by the Task Tracker's native SQLite dependency. Do not skip dependency install scripts for the live application test.

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@zebric/mcp-apps... --filter=@zebric/cli...
pnpm --filter @zebric/mcp-apps test
pnpm --filter @zebric/runtime-core exec vitest run src/blueprint/mcp-apps-parsing.test.ts src/blueprint/audit.test.ts
pnpm --filter @zebric/runtime-node exec vitest run src/blueprint/blueprint.test.ts
pnpm --filter @zebric/mcp-server test
```

The Apps tests exercise in-memory MCP and the Web Standard HTTP handler using the official MCP client, plus the embedded client's message lifecycle with a simulated DOM. The MCP server suite includes real Node HTTP/HTTPS, stdio, and a SQLite-backed Task Tracker regression. Allow local subprocesses and loopback listeners for that suite. The `workers-compatibility` test uses a generated Worker discovery contract; it does **not** run the Apps UI in workerd or a deployed Worker.

These tests do not replace a visual host check. To test just the Apps tests while iterating, rerun `pnpm --filter @zebric/mcp-apps test`; rebuild after changing dependencies or before starting a built example.

## 2. Start the sample application and adapter

Keep the same test API key in both application and adapter processes. On Bash/zsh:

```sh
export TASK_TRACKER_API_KEY=zebric-mcp-apps-local-test
pnpm --filter task-tracker dev
```

On PowerShell, set `$env:TASK_TRACKER_API_KEY = 'zebric-mcp-apps-local-test'` before running the same pnpm command. Repeat the environment assignment in each new terminal. Windows users can run the shell seeder in WSL/Git Bash, or use the form/Agent API below.

In a second terminal, seed the application:

```sh
pnpm --filter task-tracker seed
```

Alternatively, create a task in the web app at `http://127.0.0.1:3000`, or use this authenticated Agent API call (Bash/zsh):

```sh
curl --fail-with-body http://127.0.0.1:3000/api/agent/tasks \
  -H "Authorization: Bearer $TASK_TRACKER_API_KEY" \
  -H 'X-Agent-Run-ID: mcp-apps-testing' \
  -H "Idempotency-Key: mcp-apps-smoke-$(date +%s)" \
  -H 'Content-Type: application/json' \
  --data '{"title":"MCP Apps smoke test","status":"not_started","priority":"high"}'
```

PowerShell equivalent:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/agent/tasks `
  -Headers @{ Authorization = "Bearer $env:TASK_TRACKER_API_KEY"; 'X-Agent-Run-ID' = 'mcp-apps-testing'; 'Idempotency-Key' = [guid]::NewGuid().ToString() } `
  -ContentType 'application/json' `
  -Body (@{ title = 'MCP Apps smoke test'; status = 'not_started'; priority = 'high' } | ConvertTo-Json)
```

Then start the Apps adapter in a third terminal with the same key:

```sh
node packages/mcp-apps/examples/task-tracker.mjs
```

Keep it running at `http://127.0.0.1:3001/mcp`. This sample is a loopback-only, read-only MCP adapter. Its upstream API key can write for seeding, but mutations are not enabled on this MCP connection. `pnpm --filter task-tracker mcp` starts the existing tool adapter **without** Apps resource registration; use the script above for UI testing.

## 3. Inspect the protocol

Launch [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```sh
npx @modelcontextprotocol/inspector@latest
```

In the Inspector's connection UI, use its proxy, choose Streamable HTTP, and enter `http://127.0.0.1:3001/mcp`. Inspect tools and resources, then check:

1. `task_tracker_list_tasks` exists. Its `_meta.ui.resourceUri` is `ui://zebric/tasks.html`, visibility includes `model` and `app`, and `readOnlyHint` is true.
2. Read `ui://zebric/tasks.html` with `resources/read`. The MIME type is `text/html;profile=mcp-app`; the returned content is a complete HTML document. Its `_meta.ui.csp` declares empty network/resource domain arrays. No API key or initial task records appear in this static resource.
3. Call the list tool with `{}`. It returns task JSON in a text content block. Call it again with `{"status":"not_started"}`; only matching tasks should be returned.
4. Mutation tools such as `task_tracker_create_task` are absent on this read-only connection. Requesting an unknown resource should produce an MCP error.

Inspector is useful for examining protocol behavior; use an Apps host for the visual checks below. Opening `/mcp` in a browser address bar is not a connection test: GET returns **405** by design. Direct POSTs require both `application/json` and `text/event-stream` in `Accept`, and an `application/json` content type.

## 4. Check the UI in a local host

### Reference basic-host

Stop the normal HTTP adapter and restart it from Zebric's root with `node packages/mcp-apps/examples/task-tracker.mjs --browser` and the same API key. This test-only mode permits the exact browser Origin `http://localhost:8080` and implements preflight responses. The reference host connects from the browser directly; the normal adapter deliberately provides no CORS policy.

Follow the [official MCP Apps testing guide](https://apps.extensions.modelcontextprotocol.io/api/documents/testing-mcp-apps.html). Its current [start script](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-host/package.json) also requires Bun on PATH. In a separate checkout outside Zebric:

```sh
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps
npm install
cd examples/basic-host
```

Start it with the explicit adapter URL:

```sh
SERVERS='["http://127.0.0.1:3001/mcp"]' npm start
```

PowerShell: `$env:SERVERS = '["http://127.0.0.1:3001/mcp"]'`, then `npm start`. Open exactly `http://localhost:8080` (not `127.0.0.1:8080`), select the Task Tracker server and list tool, supply `{}`, and call it. Record the ext-apps commit you tested. Complete its install/build successfully; do not mix an SDK upgrade into the Zebric checkout merely to run this separate host. The test adapter still binds to loopback and does not enable mutations. Use the normal mode again when testing clients that proxy MCP requests.

### VS Code

Use a build with [MCP Apps support](https://code.visualstudio.com/docs/agents/reference/mcp-configuration). Enable `chat.mcp.apps.enabled` if needed. Merge this into `.vscode/mcp.json` in your local test workspace:

```json
{
  "servers": {
    "zebric-apps": {
      "type": "http",
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

Use **MCP: List Servers** to start the entry and inspect its output. In an agent chat with its tools enabled, ask: “Use zebric-apps to show tasks with status not_started in its interactive view.” Inspect the actual tool call and arguments before judging the UI. For remote/WSL/container workspaces, `127.0.0.1` refers to the environment running the MCP client; put the adapter there or configure forwarding explicitly.

### Local stdio / Claude Desktop

Stop the HTTP adapter if it is no longer needed. Configure the host to launch the example with `--stdio`; it must own stdin/stdout. For Claude Desktop, merge an entry into its developer MCP configuration:

```json
{
  "mcpServers": {
    "zebric-apps": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/zebric/packages/mcp-apps/examples/task-tracker.mjs", "--stdio"],
      "env": { "TASK_TRACKER_API_KEY": "zebric-mcp-apps-local-test" }
    }
  }
}
```

Use your real Node executable and checkout path; on Windows, use `C:/.../node.exe` and `C:/.../zebric/...`. The application on port 3000 must still be running. Follow [Claude's local-server setup guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), restart/reconnect, and explicitly request the task list. UI availability depends on the host build; a terminal-only client may return just the text result. For VS Code stdio, use the same command/args/env under `servers` with `"type": "stdio"`. The example disables Claude channel streaming to isolate the Apps check and writes no log messages to stdout.

### Visual acceptance checks

Run these in each visual host you intend to support:

| Check | Expected result |
| --- | --- |
| Initial call | Tasks title and table with title, status, priority; no stuck “Connecting…” state |
| Filtered call | `status: not_started` shows only those records |
| Refresh | Edit a task in the web app, then Refresh; the table updates using the original filter |
| Empty result | In a disposable sample database with no matching tasks, show “No tasks found.” |
| Detail layout | Temporarily change the sample view to `layout = "detail"`; restart adapter/reconnect; records appear as labeled values |
| Theme and size | Light/dark changes remain readable; narrow containers scroll/wrap without clipping the controls |
| Error | Restart the adapter with an incorrect upstream key, reconnect, call the tool; useful error content rather than a fabricated success |
| Text fallback | A non-Apps client receives the same usable JSON result |

Refresh is available only for a bound read-only tool when the host advertises server tool-call support. It remains disabled until complete tool input arrives. Changes to `blueprint.toml` require an adapter restart; host caches may require reconnecting, a new conversation, or a new versioned `resource_uri`. Restore temporary Blueprint edits after testing. Passing a newer Apps protocol version can emit a console warning; a missing protocol version is an initialization failure.

## 5. Test remote HTTPS and Workers/Hono

First repeat the Inspector checks against the deployed URL, then use the visual host. A hosted client cannot reach your laptop's `127.0.0.1`. Use a reachable HTTPS deployment or the host's supported private tunnel. The local sample does not configure incoming authentication or public Host handling; do not treat exposing it through a tunnel as a complete remote setup.

For Node, configure `startZebricMcpHttpServer` with incoming `authorize(request)` and an `allowedHosts` list matching the Host header your proxy actually forwards. The MCP listener's token is separate from the Task Tracker's upstream API key. Terminate HTTPS at your proxy or use the server's `tls` option. See [MCP server transport configuration](../mcp-server/README.md).

For Workers/Hono, use the [MCP server's Worker example](../mcp-server/README.md#cloudflare-workers) and add this configuration to the retained handler:

```ts
import { createMcpAppsExtension } from '@zebric/mcp-apps'

// Pass this as the handler's configureServer option:
const configureServer = createMcpAppsExtension([
  {
    name: 'tasks', title: 'Tasks', operation: 'task_tracker_list_tasks',
    layout: 'table', fields: ['title', 'status', 'priority'],
  },
])
```

Use `@zebric/mcp-server/http`, retain the handler across requests, enable `nodejs_compat` with the compatibility date documented there, and configure upstream URL/key, incoming authentication, and allowed Host headers for each environment. Bundle declarations or import a validated JSON Blueprint; do not read TOML from the filesystem inside a Worker. If your Worker application has different skill/action IDs, change the binding to match its generated OpenAPI document.

With local Wrangler, point the adapter's upstream URL at an application reachable from that runtime and allow the actual local Host (including the port). A deployed Worker needs a reachable deployed upstream or a service-bound custom `fetch`; it cannot use your development machine's loopback address. Hono mounts the same handler with `app.all('/mcp', c => handler(c.req.raw))`.

Check that unauthenticated calls to both `tools/call` and `resources/read` receive 401; authorized calls succeed. Test allowed and rejected Host/Origin headers separately. If a browser host connects directly, it may also require CORS/OPTIONS handling at your gateway; `allowedOrigins` validates origins and is not itself a CORS implementation. Prefer the host's MCP proxy for local testing. With two authenticated users, verify each call uses its authorized upstream credential. HTTP transport state is per request; persistent channel events are a separate stdio feature.

### Claude remote connector

Use [Claude's remote connector flow](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) to add your HTTPS `/mcp` URL, configure the authentication that your deployment accepts, and enable the connector in a new conversation. Fixed request headers are an option where the host exposes them. Remote connectors connect from Anthropic's infrastructure even in the desktop app; use the local stdio path for a purely local test. Run the visual checks above.

### ChatGPT custom MCP server

Follow the [official OpenAI connection/testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt). In an account/workspace with the feature available, add a custom MCP server from ChatGPT Plugins, supply the HTTPS `/mcp` URL (or select a configured Secure MCP Tunnel), and configure the matching authentication. Install/select the resulting plugin in a new conversation and explicitly request the filtered task list. Verify the actual tool result and its component. Refresh connection metadata after changing resources or tools. Do not choose OAuth unless your deployment implements its authorization discovery and flow; Zebric's `authorize` callback alone does not provide an OAuth server. Run the same visual checks; an API-only MCP test does not exercise the chat UI.

## Troubleshooting and recording results

| Symptom | Check |
| --- | --- |
| Module/export missing or view edits seem ignored | Rebuild the workspace dependencies; examples import `dist`, not `src` |
| SQLite binding missing | Use the supported Node version, reinstall with build scripts, or run `pnpm --filter @zebric/runtime-node rebuild better-sqlite3` after changing Node |
| Tools work but no UI metadata | Use the Apps-configured example; the generic MCP CLI does not load `mcp_apps` |
| `unavailable operation` | Exact `<skill>_<action>` operation ID, upstream discovery, and mutation allowlist; audit reports unknown Blueprint operations as errors and mutation bindings as warnings |
| 401 vs tool `isError` | Incoming MCP authentication vs failed upstream application credentials; inspect both layers |
| 403 | Host header, Origin header, and proxy forwarding configuration |
| 405 on `/mcp` | A browser/health probe sent GET; this endpoint uses Streamable HTTP POST |
| Blank view or stuck initialization | Host supports MCP Apps; inspect iframe/host logs for lifecycle, sandbox, and CSP errors |
| Empty view with a successful result | Task Tracker returns an array directly; omit `data_path`. Other result envelopes may require it |
| Old UI after restart | Refresh host metadata, start a new conversation, or version `resource_uri` |
| Newer protocol warning | Record the negotiated version and finish the rendering/Refresh checks; warning alone is not a failed run |

Record results per environment rather than marking an untested host as passing:

```text
Zebric revision / local changes:
OS / Node / pnpm:
Host name / version (or ext-apps commit):
Adapter runtime / transport / endpoint (no secrets):
Authentication method:
Protocol checks: pass / fail / not run
Visual checks: pass / fail / not run
Logs, screenshots, and limitations:
```

Stop the app, adapter, reference host, and any tunnel when finished. Seeding adds records to the sample database; keep existing data or use a disposable checkout/database for empty-result and destructive cases.
