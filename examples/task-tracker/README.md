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
pnpm install
pnpm --filter task-tracker dev
```

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

## Limitations of this slice

- A move updates only the dragged card's `position`. Peer cards keep their positions, so
  after many moves the sort can drift — a production board would re-rank the column on
  drop.
- No optimistic reconciliation: if the server rejects a move the card stays where it was
  dropped (the error is logged to the console).
- Single-user. Concurrent edits are last-write-wins.
