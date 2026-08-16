# `@zebric/agent`

The first-party Zebric agent library. The initial vertical slice provides deterministic Blueprint validation and safe discovery of a running application's Agent API. Deep Agents orchestration and dynamic action tools will build on these primitives.

`createZebricAgent` returns a Zebric-owned wrapper around the orchestration graph. Each `invoke` call creates isolated run and correlation IDs, while an optional caller-supplied `threadId` identifies checkpointed conversation state. Generated runtime tools propagate the invocation attribution without placing credentials or identifiers in model-visible tool inputs.

Mutation execution state records only generated idempotency keys and outstanding job URLs. The default store is process-local; deployments that need restart or multi-instance recovery should provide a durable `mutationState` implementation. When a stored job is resumed, the agent observes that job directly instead of resubmitting the mutation.

Non-GET tools exist only when an application supplies `mutations.approve`; that callback is always the final programmatic authorization boundary. The default `approval: 'callback'` mode relies on that boundary. `approval: 'human-in-the-loop'` additionally requires a checkpointer, interrupts the Deep Agents graph before calling the callback or sending HTTP, and resumes through `agent.resume(threadId, decision)`. Approval and rejection decisions are one-time: a completed interruption cannot be resumed again.

Application credentials may be supplied as `{ type: 'env', name: 'ZEBRIC_AGENT_TOKEN' }`, `{ type: 'provider', resolve }`, or the legacy provider function. Environment values are validated by name and resolved for every request, allowing rotation without rebuilding the agent. Resolved credentials are used only for the Authorization header and are redacted from successful responses and errors before they can enter model-visible results or checkpoints.

Generated tools intentionally support a bounded OpenAPI input subset: scalar string, integer, number, and boolean values; enums and defaults; string length, pattern, email, UUID, date, and date-time constraints; numeric bounds; and Zebric's JSON object-or-array field type. Unsupported references, general unions, nested structures, composition, serialization styles, parameter locations, and request-body media types fail during agent construction with application, operation, and schema-path diagnostics. They are never silently converted to weaker tool inputs.

## Preview CLI

The package exposes `zebric-agent`. Validate a Blueprint deterministically with `zebric-agent validate [blueprint] --workspace <root> --json`. Run a non-interactive, read-only agent task with `zebric-agent run --prompt <text> --model <provider:model> [--connect <url> --credential-env <name>] --json`. The preview CLI returns stable categorized exit codes and redacts the configured application credential from success and error output. Interactive sessions, configuration files, and CLI mutation approvals are not implemented yet.

## Package verification

Run `pnpm --filter @zebric/agent test:package` before publishing. It cleans and builds the package, packs both the agent and its workspace runtime dependency, rejects stale compiled tests in the archive, installs the tarballs in a fresh temporary consumer, verifies ESM imports and TypeScript declarations, and executes the installed `zebric-agent` binary. Set `ZEBRIC_PACKAGE_SMOKE_OFFLINE=1` only when the pnpm metadata mirror already contains every transitive dependency.

## Deterministic end-to-end harness

Run the agent package tests without an LLM or model-provider credentials:

```bash
pnpm --filter @zebric/agent test
```

The issue-board E2E test starts a real Zebric runtime with a temporary Blueprint and SQLite database. It seeds records through authenticated HTTP, discovers the runtime contract, generates read-only LangChain tools, and executes an explicit simulated tool-call script with `DeterministicAgentDriver`. This tests the production Agent API and agent-tool boundaries while remaining repeatable and offline.
