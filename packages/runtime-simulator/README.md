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

const webhook = runtime.triggerWebhook('/notifications/slack_ops/actions', {
  action_id: 'dispatch_approve',
  value: 'task-1',
  user_id: 'U123456',
})
```

## Current Scope

- In-memory entity storage
- Seed switching and reset
- Simulated accounts: `user` and `manager` by default
- Core `RequestHandler` and `HTMLRenderer` integration
- Client-style form submission through `submit(...)`
- Workflow debug history and manual workflow triggering
- Workflow inbound webhook triggering through `triggerWebhook(...)`
- Audit log capture for page reads, mutations, denied access, account switches, workflow triggers, and webhook triggers
- Simulated Slack, email, notification, and webhook integration outbox
- Plugin level 0 and level 1 simulation
- Simulated REST/API call logging with optional mocks

Workflow `notify`, `email`, and `webhook` steps are captured in memory. No Slack message, email, webhook request, or API request is sent by the simulator.

This runtime is not a security boundary and should only be used for preview/development workflows.
