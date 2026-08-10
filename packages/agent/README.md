# `@zebric/agent`

The first-party Zebric agent library. The initial vertical slice provides deterministic Blueprint validation and safe discovery of a running application's Agent API. Deep Agents orchestration and dynamic action tools will build on these primitives.

`createZebricAgent` returns a Zebric-owned wrapper around the orchestration graph. Each `invoke` call creates isolated run and correlation IDs, while an optional caller-supplied `threadId` identifies checkpointed conversation state. Generated runtime tools propagate the invocation attribution without placing credentials or identifiers in model-visible tool inputs.

## Deterministic end-to-end harness

Run the agent package tests without an LLM or model-provider credentials:

```bash
pnpm --filter @zebric/agent test
```

The issue-board E2E test starts a real Zebric runtime with a temporary Blueprint and SQLite database. It seeds records through authenticated HTTP, discovers the runtime contract, generates read-only LangChain tools, and executes an explicit simulated tool-call script with `DeterministicAgentDriver`. This tests the production Agent API and agent-tool boundaries while remaining repeatable and offline.
