# @zebric/react-simulator

React wrapper for the browser-only Zebric simulator runtime.

```tsx
import { ZebricSimulator } from '@zebric/react-simulator'
import '@zebric/react-simulator/styles.css'

export function Preview({ blueprintToml }: { blueprintToml: string }) {
  return (
    <ZebricSimulator
      blueprintToml={blueprintToml}
      seeds={{
        demo: {
          Task: [{ id: 'task-1', title: 'Review plan' }],
        },
      }}
      initialSeed="demo"
      initialAccount="manager"
      pluginPolicy={{ defaultLevel: 1 }}
      apiPolicy={{ mode: 'debug' }}
    />
  )
}
```

The component includes Preview, Data, Auth, Workflows, Plugins, Integrations, Audit, and Debug tabs. It is designed for browser-only authoring tools and does not require a Zebric backend. The toolbar includes account, seed, and page selectors, and the non-preview tabs use structured panels for records, accounts, workflow trigger history, plugin calls, simulated Slack/email/webhook events, audit events, and runtime logs.

The Integrations tab includes an in-memory outbox for workflow `notify`, `email`, and `webhook` steps. It also includes an inbound webhook control for workflows that define `trigger.webhook`, prefilled with a sample Slack interaction payload for quick testing.

The Preview tab preserves the inline Tailwind styles emitted by Zebric's `HTMLRenderer`, so host apps do not need to configure Tailwind just to display blueprint output correctly.
