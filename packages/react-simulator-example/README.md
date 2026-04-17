# @zebric/react-simulator-example

Editable blueprint example app for `@zebric/react-simulator`.

The example uses a plain controlled `<textarea>` for TOML editing and renders the simulator next to it. It has no LLM integration and no Zebric backend.

The simulator panel supports in-memory records, account switching, workflow triggering, audit logs, and simulated Slack/email/webhook integrations. The Integrations tab includes a sample Slack inbound webhook payload for workflows with `trigger.webhook`.

## Run

```sh
pnpm --filter @zebric/react-simulator-example dev
```

Then open `http://127.0.0.1:5173/`.

## Build

```sh
pnpm --filter @zebric/react-simulator-example build
```
