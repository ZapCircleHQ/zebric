# Zebric Roadmap

A roadmap blueprint intended to run Zebric's own product planning. It presents the same roadmap data in two deliberate contexts:

- `/` is a public, unauthenticated narrative view organized by strategic theme and `Now / Next / Later` horizon.
- `/board` is an authenticated kanban view organized by delivery state.

The blueprint also includes authenticated forms for themes, roadmap items, and public progress updates; roadmap item detail pages; an append-only decision history for delivery-state changes; and an agent skill for roadmap automation.

## Data model

| Entity | Purpose |
|---|---|
| `Theme` | Stable product themes that give the roadmap its visual hierarchy |
| `RoadmapItem` | A roadmap bet with separate horizon, delivery state, confidence, and visibility |
| `RoadmapDecision` | Audit history for status changes and their rationale |
| `RoadmapUpdate` | Publishable progress notes shown beneath the public roadmap |

`horizon` and `status` are intentionally separate. Horizon communicates product sequence to the public; status drives the team's delivery board. An item only appears publicly when `visibility = "public"`.

## Run

From the repository root:

```bash
pnpm --filter zebric-roadmap validate
pnpm --filter zebric-roadmap dev
```

Open <http://localhost:3000> for the public roadmap. Visiting <http://localhost:3000/board> requires a session.

With the dev server running, create a local editor account:

```bash
pnpm --filter zebric-roadmap seed:user
```

The defaults are `roadmap@zebric.local` and `RoadmapPass123!`. Override `DEV_EMAIL`, `DEV_PASSWORD`, and `DEV_NAME` as needed. The script also signs in and stores a local session in `.dev-user.cookies`.

## First-use sequence

1. Sign in and create strategic themes at `/themes/new`.
2. Add roadmap items at `/items/new`, using the generated theme ID.
3. Set `visibility` to `public` only when an item is ready to announce.
4. Use the item detail action bar to move work through delivery states with an audit entry.
5. Publish progress notes at `/updates/new`.

The custom views are file-backed Liquid templates with no browser dependencies. They remain projections of blueprint queries rather than independent application state.
