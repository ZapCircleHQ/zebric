# Task Tracker Example

A task management app built on the Zebric **board widget** — a declarative drag-and-drop
kanban described entirely in `blueprint.toml`, with no custom client JavaScript.

It doubles as the flagship **MCP example**: the same tasks are discoverable and
manageable through typed agent tools.

## What this shows

- **Drag-and-drop** task cards between the Not Started / In Progress / Done columns —
  each drop sets the task's `status` and its rank within the column
- **Card toggle** — click the star to flip an `important` flag on the task
- **Cards with context** — title links to the task, plus a description line and
  priority / due-date chips (`card.subtitle`, `card.meta`, `card.href`)
- **Standard forms** for creating and editing tasks
- **Agent API** — `list_tasks`, `get_task`, `create_task`, `update_task`,
  `set_task_status`, and `delete_task` exposed as MCP tools

Every interaction is a typed event (`on_move`, `on_toggle`) that the blueprint maps to a
data update. The runtime's shared client bundle handles all the DOM wiring.

## Running

```bash
# From the zebric root
pnpm install --frozen-lockfile
pnpm --filter task-tracker... build
pnpm --filter task-tracker dev
```

Requires Node.js 24 and pnpm 11.23.0 for repository development. The filtered
build prepares the CLI, runtime, and MCP server before the example uses them.

The board renders immediately with three empty columns. To populate it with a few
sample tasks:

```bash
pnpm --filter task-tracker seed
```

Then open http://localhost:3000.

## Blueprint shape

The columns are fixed in the blueprint — one per `Task.status` value — so there is no
`Column` entity and nothing to seed for them.

```toml
[page."/".widget]
kind      = "board"
entity    = "Task"
group_by  = "status"
rank_field = "position"

[[page."/".widget.columns]]
value = "not_started"
label = "Not Started"
# ...in_progress, done

[page."/".widget.card]
title    = "title"
subtitle = "description"
meta     = ["priority", "dueDate"]
href     = "/tasks/{id}"
toggles  = [{ field = "important", label_on = "★", label_off = "☆" }]

[page."/".widget.on_move]
update = { status = "$to.id", position = "$index", updatedAt = "$now" }

[page."/".widget.on_toggle]
update = { "$field" = "!$row.$field", updatedAt = "$now" }
```

## Running the MCP server

The Blueprint publishes `list_tasks`, `get_task`, `create_task`, `update_task`,
`set_task_status`, and `delete_task` as agent-facing skill actions. Create and update
inputs are derived automatically from the `Task` entity; destructive deletion is
separately scoped and explicitly allowlisted. Start the application with its scoped API
key:

```bash
TASK_TRACKER_API_KEY=development-secret pnpm --filter task-tracker dev
```

Then configure an MCP client to launch the stdio adapter with the same environment
variable:

```bash
TASK_TRACKER_API_KEY=development-secret pnpm --filter task-tracker mcp
```

Read tools are available automatically. Each mutation is exposed only when its exact
OpenAPI operation ID is allowlisted (see the `--allow-mutation` flags in `package.json`).

## Testing the MCP Apps view

The `[[mcp_apps]]` declaration exposes the task list as an interactive table. After
building the workspace and starting this application with `TASK_TRACKER_API_KEY`, run
this from the repository root in another terminal with the same key:

```bash
node packages/mcp-apps/examples/task-tracker.mjs
```

Connect an MCP Apps host to `http://127.0.0.1:3001/mcp` and request
`task_tracker_list_tasks`. For a host-managed local stdio connection,
configure it to launch that script with `--stdio` instead. This Apps example exposes
reads and registers the HTML resources; the `mcp` package script above is the separate
tool-only example with explicitly allowed mutations.

See the [MCP Apps testing guide](https://docs.zebric.dev/building/mcp-apps-testing/) for build commands,
Windows setup, VS Code and Claude configurations, remote ChatGPT/Claude testing,
Workers/Hono, and the expected visual results.

## Limitations of this slice

- A move updates only the dragged card's `position`. Peer cards keep their positions, so
  after many moves the sort can drift — a production board would re-rank the column on
  drop.
- No optimistic reconciliation: if the server rejects a move the card stays where it was
  dropped (the error is logged to the console).
- Single-user. Concurrent edits are last-write-wins.
