# Zebric Dispatch Example

`zebric-dispatch` is an internal workflow app for approvals, request intake, and agent/team collaboration.  
This first pass implements the core operating loop from `USER-STORIES.md`: collect requests, triage them quickly, and keep roadmap/status decisions visible.

## MVP Scope Implemented

- Unified intake model for `slack`, `linear`, `github`, `notion`, and manual capture
- Triage-focused request lifecycle (`new` -> `triage` -> `planned` / `in_progress` / `blocked` / `resolved`)
- Founder-facing dashboard queries (hot requests, blocked items, planned candidates)
- Request clustering entity for thematic grouping
- Decision/audit log entity for priority/status reasoning
- PR linking model for GitHub progress visibility
- Manual action-bar workflows for fast status and roadmap bucket updates

## Story Coverage (Initial)

- Covered now:
  - Story 1.1, 1.2, 1.3, 1.4 (intake data model + capture form)
  - Story 3.1 (dashboard visibility)
  - Story 5.2 (PR links)
  - Story 6.1, 6.2 (triage queue + metadata-first request schema)
  - Story 7.2, 7.3 (roadmap buckets + change log)
  - Story 8.1 (request fields for blueprint behavior/path mapping)
- Stubbed for next iteration:
  - Sync automations (Linear/GitHub/Slack bi-directional updates)
  - LLM dedupe, clustering, and routing workflows
  - SLA stagnation alerts
  - Fire detection, team load radar, customer trend analytics

## Files

```text
zebric-dispatch/
├── USER-STORIES.md
├── blueprint.toml
├── README.md
├── package.json
└── test-workflows.sh
```

## Run

From repo root:

```bash
pnpm --filter zebric-dispatch dev
```

Then open http://localhost:3000.

## Workflow Smoke Test

With Dispatch running locally:

```bash
BASE_URL=http://127.0.0.1:3000 ./examples/zebric-dispatch/test-workflows.sh
```

## Suggested Next Build Steps

1. Add ingestion workflows that create/update `Request` from webhook payloads in `ExternalSignal`.
2. Add webhook/LLM workflow for duplicate detection and cluster suggestions.
3. Add SLA policy workflow (`schedule`) and escalation notifications for stagnating critical requests.
4. Add custom triage panel behavior with keyboard shortcuts for inbox-zero flow.
