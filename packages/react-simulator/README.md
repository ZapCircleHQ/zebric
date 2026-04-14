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

The component includes Preview, Data, Auth, Workflows, Plugins, and Debug tabs. It is designed for browser-only authoring tools and does not require a Zebric backend. The non-preview tabs use structured panels for records, accounts, workflow trigger history, plugin calls, and runtime logs.

The Preview tab preserves the inline Tailwind styles emitted by Zebric's `HTMLRenderer`, so host apps do not need to configure Tailwind just to display blueprint output correctly.
