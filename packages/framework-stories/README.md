# Zebric Framework Stories

User stories captured as executable integration tests. Each story references the blueprint/material it exercises and provides guardrails for critical flows.

## Running stories

```
pnpm --filter @zebric/framework-stories test
```

This will build the shared runtime dependencies and then execute every `*.story.test.ts` file under `src/stories`.

## Structure

- `src/stories/story-registry.ts` – central list of story IDs, descriptions, blueprints, and owning tests.
- `src/stories/*.story.test.ts` – Vitest files that load the referenced blueprint and assert the behavior described in the story.
- `src/utils/load-blueprint.ts` – helper that reuses the runtime-core blueprint parser so we validate the same structure the engine consumes.

Add new stories by updating the registry and creating a matching `*.story.test.ts` file to exercise the scenario end-to-end.
