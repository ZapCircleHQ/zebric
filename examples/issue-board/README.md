# Issue Board — Widget Example

A Kanban-style issue tracker demonstrating the Zebric **widget system**: a declarative primitive for interactive views described entirely in blueprint TOML, with no custom client JavaScript per blueprint.

## What this shows

- **Drag-and-drop** cards between columns and reorder within a column
- **Inline column rename** — double-click a column header
- **Card toggle** — click the star to flip an `important` boolean on the issue

Every user interaction is a typed event (`on_move`, `on_column_rename`, `on_toggle`) that the blueprint maps to a data update. The runtime's shared client bundle handles all DOM wiring.

## Run

```bash
pnpm install
pnpm --filter issue-board-example dev
```

In another terminal, seed sample data:

```bash
pnpm --filter issue-board-example seed
```

Then open http://localhost:3000.

## Blueprint shape

```toml
[page."/".widget]
kind          = "board"
entity        = "Issue"
group_by      = "columnId"
column_entity = "Column"
column_label  = "name"
column_order  = "position"
rank_field    = "position"

[page."/".widget.card]
title   = "title"
toggles = [
  { field = "important", label_on = "★", label_off = "☆" }
]

[page."/".widget.on_move]
update = { columnId = "$to.id", position = "$index" }

[page."/".widget.on_column_rename]
update = { name = "$value" }

[page."/".widget.on_toggle]
update = { "$field" = "!$row.$field" }
```

## Limitations of this first slice

- Reordering within a column only updates the dragged card's `position`. Peer cards keep their old positions, so after many moves the sort may drift. A production board needs full column re-ranking on drop.
- No optimistic reconciliation if the server rejects a move — the visual stays where the user dropped it even if persistence failed (errors are logged to the console).
- Single-user only. See the widget design memo — multiplayer/CRDT sync is deliberately out of scope.
