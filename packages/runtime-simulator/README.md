# @zebric/runtime-simulator

Browser-only simulator runtime for Zebric blueprints.

This package is intended for development previews and embedded authoring tools. It keeps data in memory, simulates accounts and plugins, and avoids real network calls by default.

## Usage

```ts
import { ZebricSimulatorRuntime } from '@zebric/runtime-simulator'

const runtime = new ZebricSimulatorRuntime({
  blueprintToml,
  seeds: {
    demo: {
      Task: [{ id: 'task-1', title: 'Review plan' }],
    },
  },
  initialSeed: 'demo',
  initialAccount: 'manager',
  pluginPolicy: { defaultLevel: 1 },
  apiPolicy: { mode: 'debug' },
})

const page = await runtime.render('/')
```

## Current Scope

- In-memory entity storage
- Seed switching and reset
- Simulated accounts: `user` and `manager` by default
- Core `RequestHandler` and `HTMLRenderer` integration
- Client-style form submission through `submit(...)`
- Workflow debug history and manual workflow triggering
- Plugin level 0 and level 1 simulation
- Simulated REST/API call logging with optional mocks

This runtime is not a security boundary and should only be used for preview/development workflows.
