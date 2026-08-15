# Zebric Agent v1 Implementation Tasks

## Goal

Build a first-party Zebric agent on the TypeScript Deep Agents SDK that can work in two complementary contexts:

1. **Operate a running Zebric application** through its Agent API and declared skills.
2. **Assist with Zebric application development** by inspecting, validating, explaining, and safely improving Blueprints and related project files.

The agent should understand Zebric conventions, but Zebric runtime behavior must remain authoritative. Deterministic operations such as Blueprint parsing, schema validation, reference validation, API argument validation, and workflow-state enforcement must be implemented as tools or runtime checks rather than entrusted to the model.

This document is a companion to [Agent API v1](./AGENT_API_V1_TASKS.md). The Agent API defines how any external agent drives a running application; this document defines Zebric's own opinionated agent client and authoring assistant.

## Product Definition

Zebric Agent v1 is a reusable agent package with a CLI as its first user interface.

Representative tasks:

```text
Connect to http://localhost:3000 and summarize the work ready for QA.

Claim the next Ready to Test card, execute the available QA procedure,
and submit the result through the application's workflow.

Validate examples/zebric-roadmap/blueprint.toml and explain every error.

Review this Blueprint for broken references, unsafe public access,
missing agent actions, and unnecessarily repetitive configuration.

Suggest a skill that lets an agent triage issues without exposing generic
delete or unrestricted update operations.
```

The agent is not a replacement for the runtime, Blueprint loader, permission manager, test runner, or Agent API. It orchestrates those deterministic systems and explains their results.

The reusable agent must remain application-neutral. It discovers semantic skills and schemas from each running Zebric application; it must not encode issue-board statuses, candidate-selection rules, QA result shapes, or other domain policy in `@zebric/agent`. Reference procedures and test doubles belong to their example application or an explicitly installed extension.

## Non-Goals for v1

- Hosting the model inside every Zebric runtime process.
- Creating a second workflow or authorization engine in the agent.
- Letting the model invent or call undeclared application endpoints.
- General-purpose autonomous software development outside Zebric projects.
- A graphical chat interface; the CLI and library API come first.
- Fully autonomous production mutations without configurable approval policy.
- Training or fine-tuning a Zebric-specific model.
- Requiring MCP for the initial implementation.

## Why Deep Agents

Deep Agents provides the orchestration primitives needed for longer Zebric tasks:

- planning and task decomposition;
- pluggable filesystem backends;
- context offloading and summarization;
- subagents for isolated specialist work;
- checkpointed threads and persistent memory;
- human approval around sensitive tool calls;
- custom tools and middleware.

Zebric should build on these primitives while keeping framework-specific types behind a small internal adapter. Deep Agents is an implementation dependency, not part of the public Zebric Agent contract.

## High-Level Architecture

```text
CLI / library consumer
        |
        v
Zebric Agent session
  - system instructions
  - task planning
  - approval policy
  - thread/checkpoint state
        |
        +--------------------------+
        |                          |
        v                          v
Authoring tools                Runtime tools
  validate Blueprint            discover application
  inspect Blueprint             load OpenAPI contract
  suggest changes               call declared actions
  apply approved patch          observe workflow jobs
  run project checks            inspect runtime state
        |                          |
        v                          v
@zebric/runtime-core          Zebric Agent API v1
and restricted workspace      over authenticated HTTP
```

### Proposed workspace package

Create a new package:

```text
packages/agent/
  src/
    agent/
      create-zebric-agent.ts
      prompts.ts
      context.ts
      policy.ts
    authoring/
      blueprint-tools.ts
      project-tools.ts
      suggestions.ts
    runtime/
      discovery-client.ts
      openapi-client.ts
      action-tool-factory.ts
      job-client.ts
    config/
      schema.ts
      loader.ts
    cli/
      index.ts
      commands.ts
      output.ts
    telemetry/
      events.ts
      tracing.ts
    index.ts
  tests/
  package.json
  README.md
```

Suggested package name:

```text
@zebric/agent
```

The initial implementation should use the JavaScript/TypeScript `deepagents` package so it fits the existing Zebric monorepo and can directly reuse `@zebric/runtime-core` types and validation.

## Agent Operating Modes

The user may combine modes in one task, but tools and permissions remain distinct.

### Connect mode

The agent connects to a running application using a base URL and credential. It discovers and calls only the skills published by that application.

```text
zebric-agent connect http://localhost:3000
```

Connect mode does not imply local filesystem access.

### Author mode

The agent works within a Zebric project directory. It can inspect project files and run deterministic Blueprint validation. Writes require explicit policy or approval.

```text
zebric-agent author --workspace .
```

Author mode does not imply access to a running production application.

### Combined mode

The agent can compare a local Blueprint with a running application, diagnose configuration behavior, or implement a change and validate it locally.

```text
zebric-agent --workspace . --connect http://localhost:3000
```

Credentials and filesystem authority must be configured independently. Connecting to an application must never silently broaden workspace permissions, or vice versa.

## Trust and Execution Model

### Read-only by default

The default policy should allow:

- runtime discovery and OpenAPI reads;
- runtime actions explicitly marked safe/read-only;
- Blueprint parsing and validation;
- reading allowed Zebric project files;
- generating suggestions and patches without applying them.

The default policy should require approval for:

- any runtime action that mutates state;
- writing or editing project files;
- shell execution;
- uploading evidence or sending notifications;
- accessing a newly discovered host;
- actions classified as high impact by the application.

### Distinct policy layers

Deep Agents human-in-the-loop configuration is one enforcement layer, not the only layer. Add a Zebric policy layer that evaluates structured tool metadata before execution:

```ts
type ZebricToolRisk = 'read' | 'write' | 'destructive' | 'external-effect'

interface ZebricToolPolicy {
  risk: ZebricToolRisk
  application?: string
  requiredScopes?: string[]
  resource?: string
}
```

Runtime authorization remains authoritative even after local approval.

### Filesystem isolation

- Use a virtualized `FilesystemBackend` rooted at the selected workspace for local CLI use.
- Deny reads of common secret files such as `.env`, credential stores, private keys, and package-manager auth files by default.
- Deny writes outside the selected workspace.
- Prefer an isolated sandbox when shell execution is enabled in hosted or CI environments.
- Do not assume Deep Agents filesystem permissions cover custom Zebric tools; enforce paths inside each custom tool as well.

## Milestone 1: Package and Agent Skeleton

### 1.1 Create `@zebric/agent`

- [x] Add `packages/agent` to the pnpm workspace.
- [x] Add TypeScript build, lint, test, and package exports.
- [x] Add `deepagents` and required LangChain/LangGraph dependencies.
- [ ] Pin or intentionally bound compatible dependency ranges and document the tested Deep Agents/LangChain versions.
- [ ] Re-export only Zebric-owned public types from the package root.
- [ ] Keep Deep Agents-specific construction details in internal modules.
- [x] Add a changeset for the new package when it becomes publishable.

### 1.2 Define the public factory

- [x] Implement `createZebricAgent(options)`.
- [x] Accept a model or model identifier without coupling the API to one provider.
- [ ] Accept runtime connections, workspace configuration, policy, checkpointer, and telemetry options.
- [x] Validate model, workspace aliasing, application names, duplicate connections, and credential-free HTTP(S) application URLs before constructing the agent.
- [x] Return a stable Zebric-owned `ZebricAgent` wrapper rather than exposing an untyped Deep Agents graph directly.

Proposed API:

```ts
const agent = await createZebricAgent({
  model: 'provider:model',
  workspace: {
    root: process.cwd(),
    mode: 'read-only',
  },
  applications: [
    {
      name: 'local',
      baseUrl: 'http://localhost:3000',
      credential: { type: 'env', name: 'ZEBRIC_AGENT_TOKEN' },
    },
  ],
  approval: 'human-in-the-loop',
});
```

### 1.3 Establish agent context

- [x] Define typed invocation-local runtime context containing workspace, applications, agent run ID, correlation ID, thread ID, and policy.
- [x] Resolve credentials through non-model-visible providers at request time.
- [x] Prove resolved application credentials remain absent from prompts, model messages, checkpoints, returned graph state, and model-visible tool results.
- [ ] Prove model-provider credentials remain absent from provider traces and CLI output, and all credentials remain absent from future Zebric telemetry.
- [x] Generate a unique run ID for each top-level task.
- [x] Propagate a trusted agent run ID through runtime mutation tools using `X-Agent-Run-ID`.
- [x] Propagate a unique correlation identifier through runtime API tools and job polling.
- [x] Define caller-supplied checkpoint thread IDs separately from generated run IDs.

### 1.4 Add a minimal CLI

- [x] Add a `zebric-agent` binary.
- [x] Support deterministic `validate` and non-interactive read-only `run --prompt` commands; interactive prompting remains open.
- [x] Support `--workspace`, `--connect`, and `--model`; project-local `--config` remains open.
- [x] Provide stable exit codes for success, configuration, validation, approval rejection, authentication/authorization, conflict, incomplete execution, and internal failure.
- [x] Add structured JSON output for automation.
- [x] Redact the configured application credential from CLI success and error output; model-provider credential and future telemetry tests remain open.

### Acceptance criteria

- A developer can create an agent through the library and CLI.
- A no-tool prompt completes with checkpointed thread state.
- Configuration errors fail before a model call.
- Credentials do not appear in traces, state, or CLI output.

## Milestone 2: Deterministic Blueprint Tools

### 2.1 Reuse the canonical Blueprint loader

- [x] Call the canonical `BlueprintParser` from `@zebric/runtime-core` directly.
- [x] Do not duplicate the Zod schema or reference-validation rules in the agent package.
- [x] Return structured validation details including path, code, message, and existing suggestions.
- [x] Support TOML and JSON Blueprints consistently with the CLI.
- [ ] Include engine-version validation when a target version is supplied.
- [x] Add fixture tests shared with or derived from CLI validation cases.

Tool:

```text
validate_blueprint
```

Inputs:

```json
{
  "path": "blueprint.toml",
  "engineVersion": "optional"
}
```

### 2.2 Add structured Blueprint inspection

- [ ] Add a tool that returns a bounded summary of project metadata, entities, pages, workflows, skills, auth, plugins, and notifications.
- [ ] Add targeted lookups for a named entity, page, workflow, or skill.
- [ ] Add reference traversal such as “which pages and workflows use this entity?”
- [ ] Avoid returning the entire parsed Blueprint when a focused result will do.

Tools:

```text
inspect_blueprint
find_blueprint_references
```

### 2.3 Add deterministic lint rules

- [ ] Define a versioned lint-rule registry separate from schema validity.
- [ ] Give every rule a stable ID, severity, rationale, and remediation guidance.
- [ ] Support rule suppression in a documented configuration format.
- [ ] Start with high-confidence rules only.
- [ ] Keep model-generated opinions distinct from deterministic lint findings.

Candidate initial rules:

- public pages backed by entities without intentional anonymous read permission;
- skills exposing generic delete or unrestricted update actions;
- state-changing workflows exposed without clear preconditions;
- workflow-backed actions with insufficient body schemas;
- missing descriptions on agent-facing actions;
- unbounded list actions;
- workflows or skills that are valid but unreachable;
- sensitive-looking environment configuration exposed as entity data;
- broad API keys with no scoped replacement once Agent API v1 scopes exist.

Tool:

```text
lint_blueprint
```

### 2.4 Explain validation findings

- [ ] Prompt the model with structured findings and only the necessary Blueprint excerpts.
- [ ] Preserve deterministic severity and location in the explanation.
- [ ] Clearly label inferred design advice as a suggestion rather than an error.
- [ ] Never claim a suggested edit is valid until it passes `validate_blueprint`.

### Acceptance criteria

- `zebric-agent validate blueprint.toml` agrees with `zebric validate` on validity.
- Validation requires no model call.
- The model can explain errors without changing their locations or codes.
- Lint findings and model suggestions are visibly distinct.

## Milestone 3: Safe Blueprint Suggestions and Edits

### 3.1 Add a Blueprint review workflow

- [ ] Inspect project goals and relevant Blueprint sections.
- [ ] Run validation and linting first.
- [ ] Review data modeling, routes, workflows, permissions, agent exposure, and maintainability.
- [ ] Produce prioritized findings with evidence and affected configuration paths.
- [ ] Avoid recommending features unsupported by the installed runtime version.

### 3.2 Generate bounded patch proposals

- [ ] Produce unified diffs rather than rewriting entire files.
- [ ] Include the reason, behavioral impact, and risk for each patch.
- [ ] Require approval before applying a patch by default.
- [ ] Reject edits outside configured workspace roots.
- [ ] Preserve unrelated user changes.
- [ ] Never edit secret files.

Tools:

```text
propose_blueprint_patch
apply_blueprint_patch
```

`propose_blueprint_patch` should have no write authority. `apply_blueprint_patch` should accept only the previously generated patch plus its integrity identifier.

### 3.3 Validate every applied change

- [ ] Parse and validate the changed Blueprint after application.
- [ ] Run Blueprint lint rules.
- [ ] Run targeted tests or CLI validation when configured.
- [ ] Report pre-existing failures separately from newly introduced failures.
- [ ] If validation fails, retain the patch and explain remediation; do not perform broad automatic rollback that could discard user edits.

### 3.4 Add suggestion quality fixtures

- [ ] Create representative valid, invalid, insecure, and overly repetitive Blueprints.
- [ ] Define expected deterministic findings.
- [ ] Evaluate model suggestions for supportability, locality, and non-destructiveness.
- [ ] Test that suggested syntax validates against the current schema.

### Acceptance criteria

- The agent can propose a minimal fix for a known validation failure.
- No file is modified before the configured approval point.
- Every applied Blueprint change is revalidated deterministically.
- The agent preserves unrelated edits in a dirty workspace.

## Milestone 4: Runtime Discovery and Dynamic Tools

### 4.1 Implement application discovery

- [x] Fetch `/.well-known/zebric-agent.json` when supported.
- [x] Fall back to `/api/openapi.json` for older runtimes.
- [x] Validate discovery and OpenAPI responses against local schemas.
- [x] Enforce HTTP(S) schemes, same-origin discovered contracts, and redirect rejection.
- [ ] Add a configurable host/private-network policy for SSRF-sensitive deployments.
- [ ] Set request timeouts, response-size limits, and redirect restrictions.
- [ ] Cache contracts using HTTP cache metadata while allowing explicit refresh.
- [ ] Report runtime/contract incompatibility clearly.

### 4.2 Resolve credentials safely

- [x] Support validated environment-variable credential references in the library while retaining injectable providers for secret managers.
- [x] Support an injectable credential-provider interface for keychains and hosted secret managers.
- [x] Resolve credentials only at request execution time.
- [x] Do not store resolved tokens in generated tool schemas, descriptions, or returned errors.
- [x] Test exact-value application credential redaction across prompts/model calls, checkpoints, returned state, successful response fields, error messages, and deterministic transcripts.
- [ ] Test application and model-provider credential redaction across provider traces, future Zebric telemetry, encoded/derived secret forms where applicable, and model-provider CLI failures.

### 4.3 Generate tools from OpenAPI operations

- [x] Generate tools only from operations in the validated Zebric OpenAPI contract.
- [x] Use `operationId` as the stable operation identity and sanitize generated tool names.
- [x] Detect sanitized tool-name collisions across operations and connected applications before constructing the agent.
- [x] Convert the current Zebric scalar, enum, and JSON-field schema subset to runtime-validated tool schemas.
- [x] Support the bounded Zebric input-schema subset and explicitly reject `$ref`, general unions, nested objects, arrays, composition, unknown types/formats/keywords, unsupported parameter serialization/locations, path-level parameters, and non-JSON or multi-media request bodies with contract diagnostics.
- [x] Preserve operation descriptions, enum values, and required fields for the supported schema subset.
- [ ] Preserve examples and richer schema annotations.
- [ ] Attach risk, required scopes, HTTP method, application, and operation metadata to each tool.
- [x] Do not expose arbitrary URL, header, method, or request-body escape hatches.
- [x] Reject HTTP and job responses exceeding the configured inline size limit.
- [ ] Offload supported large results to a configured backend instead of returning them inline.

### 4.4 Classify action risk

- [ ] Prefer explicit risk metadata from Agent API v1.
- [x] Expose `GET` operations as read tools by default.
- [x] Keep non-GET operations unavailable unless an explicit mutation approval policy is configured.
- [ ] Require explicit configuration before any operation is considered destructive or safe for auto-approval.
- [x] Show the target application, semantic operation, HTTP target, and locally validated arguments in callback and human-in-the-loop approval requests.

### 4.5 Refresh tools safely

- [ ] Detect contract version or ETag changes.
- [ ] Freeze the tool contract within an active model turn.
- [ ] Refresh between turns or after an explicit discovery action.
- [ ] Reject pending calls whose operation disappeared or changed incompatibly.
- [ ] Record the contract fingerprint used for every action.

### Acceptance criteria

- Given only a base URL and credential reference, the agent discovers available Zebric skills.
- It cannot call an endpoint that is absent from the published contract.
- All arguments are validated locally before the HTTP request.
- Mutating calls stop at the configured approval boundary.

## Milestone 5: Runtime Action and Job Execution

### 5.1 Build the HTTP execution client

- [x] Add Bearer authentication without exposing tokens to the model.
- [x] Send idempotency identifiers for mutations.
- [x] Apply per-request timeouts and cancellation.
- [x] Parse stable Agent API error envelopes into safe typed failures without retaining unrecognized response fields.
- [x] Distinguish authentication, authorization, validation, missing-resource, conflict, rate-limit, and server failures.
- [ ] Retry only documented retryable failures.
- [x] Never automatically retry an unsafe mutation without idempotency protection.

### 5.2 Add idempotency behavior

- [x] Invoke a configured idempotency-key provider for every fresh logical mutation, while reusing stored keys for uncertain retries.
- [x] Generate and persist stable logical-mutation keys in an injectable execution-state store scoped by thread/run, application, operation, target, and canonical arguments.
- [x] Reuse a key only while an identical mutation has an uncertain or outstanding result; clear it after a known terminal response.
- [x] Let the runtime reject reuse after arguments or the target resource change.
- [x] Store keys and job URLs through a credential-free execution-state interface; the default implementation is process-local and durable deployments must inject persistent storage.
- [x] Surface HTTP `409` conflicts instead of treating them as success.
- [ ] Parse stable error codes so idempotency conflicts are distinguishable from state/version conflicts.

### 5.3 Observe asynchronous workflows

- [x] Recognize `202 Accepted` job responses.
- [x] Poll the declared job URL with a bounded interval and attempt limit.
- [x] Support a maximum wait policy.
- [x] Resume observation from stored job state without resubmitting the mutation.
- [x] Return the terminal workflow result to the agent.
- [x] Avoid claiming success before the job reaches a successful terminal state.

### 5.4 Handle optimistic concurrency

- [ ] Preserve ETags or record versions from reads.
- [ ] Supply expected versions to mutation actions when supported.
- [ ] On conflict, fetch authoritative state before deciding what to do.
- [x] Never silently overwrite a concurrent actor's state transition.

### Acceptance criteria

- The agent can invoke a semantic workflow and accurately report its terminal outcome.
- A timed-out mutation can be retried without duplicating work.
- `401`, `403`, `409`, and failed workflow jobs lead to distinct behavior.
- A resumed thread can continue observing an outstanding job.

## Milestone 6: Issue-Board QA Reference Procedure

This milestone is a conformance scenario for `examples/issue-board`, not business logic shipped by the generic agent package.

### 6.1 Implement the reference QA procedure

- [x] Discover the application's QA skill rather than assuming fixed route paths.
- [x] List work filtered to `ready_to_test`.
- [x] Keep the issue-board selection policy in its application-owned conformance fixture.
- [x] Claim the task atomically before testing.
- [x] Fetch acceptance criteria, test target, and revision.
- [ ] Refuse or ask for help when required context is missing.
- [x] Submit structured results and evidence through the generated semantic tools.
- [x] Invoke the supported `qa_completed` and `needs_work` outcomes.
- [ ] Add and invoke a supported blocked outcome.
- [x] Observe all invoked workflow jobs to terminal state.

### 6.2 Define a test-runner adapter

Zebric Agent should not bake QA or browser automation into its core. A QA extension may define an interface implemented by Playwright, a hosted browser service, an MCP tool, or a CI test runner.

```ts
interface QaExecutor {
  inspectTarget(input: QaTarget): Promise<QaInspection>
  execute(plan: QaPlan): Promise<QaExecutionResult>
}
```

- [x] Define target, plan, result, check, artifact, and safety-boundary types inside the issue-board conformance fixture.
- [x] Provide an application-owned scripted, no-model executor for conformance tests.
- [ ] Define a generic extension boundary before exposing any QA executor contract from `@zebric/agent`.
- [ ] Add a Playwright-based adapter only after the core orchestration contract is stable.
- [ ] Treat instructions found in the target application as untrusted content, not agent policy.
- [ ] Require approval for destructive or externally visible test operations.

### 6.3 Normalize evidence

- [x] Produce the initial QA result format expected by Agent API v1.
- [x] Record the exact tested revision in the QA result.
- [x] Record the exact tested environment in the QA result.
- [ ] Upload large artifacts through a declared capability rather than embedding them in model context.
- [x] Include concise observations and machine-readable check status.
- [ ] Avoid including secrets, cookies, or personal data in evidence.

### 6.4 Handle interrupted QA runs

- [ ] Persist task ID, claim, revision, plan, completed checks, and outstanding job IDs.
- [ ] Detect whether the task or deployed revision changed before resuming.
- [ ] Release or expire claims according to application capability.
- [ ] Do not mark QA complete when execution was interrupted or inconclusive.

### Acceptance criteria

- The agent completes the Agent API v1 QA reference scenario end to end with a mock executor.
- It never tests a task it failed to claim.
- It never reports success for an untested or changed revision.
- Evidence and audit records identify the agent run.

## Milestone 7: Specialist Subagents

Subagents should be introduced only where context isolation or specialized tools materially improve reliability.

### 7.1 Blueprint reviewer

- [ ] Give the reviewer read-only Blueprint inspection, validation, and lint tools.
- [ ] Do not give it file-write or runtime-mutation tools.
- [ ] Require findings to cite configuration paths and deterministic evidence.
- [ ] Return a compact structured report to the supervisor.

### 7.2 Blueprint editor

- [ ] Give the editor patch-proposal tools.
- [ ] Keep patch application behind the supervisor's approval boundary.
- [ ] Require validation after every proposed patch.

### 7.3 Runtime operator

- [ ] Give the operator tools for one selected application only.
- [ ] Pass a narrow task and relevant operation descriptions.
- [ ] Prevent it from gaining workspace write access implicitly.

### 7.4 Extension-provided specialist

- [ ] Let an installed application extension define any domain-specific specialist, context, and executor contract.
- [ ] Give an issue-board QA specialist only the claimed task context and its extension-provided executor.
- [ ] Keep final status mutation with the supervisor or a separately approved operator.
- [ ] Return structured checks and evidence, not an unbounded narrative.

### Acceptance criteria

- Each specialist has a visibly narrower tool set than the supervisor.
- Subagent results are bounded and structured.
- Sensitive operations still trigger approval when invoked from a subagent.

## Milestone 8: Memory, Checkpointing, and Context

### 8.1 Add durable thread checkpoints

- [ ] Make a checkpointer mandatory for approval workflows and resumable jobs.
- [ ] Persist active plans, approvals, idempotency keys, contract fingerprints, and job references.
- [ ] Keep credentials and raw authorization headers out of checkpoints.
- [ ] Add schema/version migration for checkpointed Zebric context.

### 8.2 Define memory boundaries

- [ ] Keep per-run scratch material ephemeral.
- [ ] Store project conventions only after explicit user instruction or configured policy.
- [ ] Namespace persistent memory by organization, project, and agent identity.
- [ ] Do not store application records, secrets, or sensitive QA evidence as long-term memory by default.
- [ ] Provide a command to inspect and delete agent memory.

### 8.3 Control context size

- [ ] Summarize large OpenAPI contracts into operation indexes while retaining retrievable source artifacts.
- [ ] Return focused Blueprint sections instead of complete files where possible.
- [ ] Offload large tool outputs and artifacts to backend storage.
- [ ] Preserve exact deterministic validation results even when surrounding conversation is summarized.

### Acceptance criteria

- A process restart can resume an approval or outstanding workflow job.
- Persistent memory is isolated between projects.
- No credential appears in persisted state.
- Large contracts do not need to be placed wholesale in the model context.

## Milestone 9: Configuration and UX

### 9.1 Define configuration

- [ ] Support a project-local configuration file such as `zebric-agent.toml`.
- [ ] Define model, applications, credential references, workspace mode, approval policy, memory, and test-runner adapters.
- [ ] Support environment overrides without embedding secret values in the file.
- [ ] Validate unknown keys and incompatible settings.
- [ ] Print the effective non-secret configuration for diagnostics.

Example:

```toml
model = "provider:model"
approval = "human-in-the-loop"

[workspace]
root = "."
mode = "read-write"

[[application]]
name = "local"
baseUrl = "http://localhost:3000"
credentialEnv = "ZEBRIC_LOCAL_AGENT_TOKEN"

[memory]
mode = "project"
```

### 9.2 Add task-oriented CLI commands

- [ ] `zebric-agent chat`
- [x] `zebric-agent validate [blueprint]`
- [ ] `zebric-agent review [blueprint]`
- [ ] `zebric-agent connect <url>`
- [x] `zebric-agent run --prompt <text>` (non-interactive and read-only in the preview CLI)
- [ ] Support extension-provided commands without baking their business vocabulary into the core CLI; an issue-board extension may provide `qa`.
- [ ] `zebric-agent threads list|resume|delete`
- [ ] `zebric-agent memory inspect|clear`
- [ ] Decide whether these later become subcommands of the main `zebric` CLI.

### 9.3 Make approvals understandable

- [x] Show the application and HTTP target for runtime mutation approvals.
- [ ] Show the semantic action and full read/write/destructive/external-effect risk classification.
- [x] Show locally validated runtime arguments without adding arbitrary headers or URLs.
- [x] Offer one-time approve and reject decisions for runtime mutations; argument editing remains unsupported.
- [ ] Distinguish one-time approval from persistent policy changes.
- [ ] Record the decision without recording secrets.

### Acceptance criteria

- Common validation and connection tasks require no custom code.
- Non-interactive mode produces stable structured output and exit codes.
- Approval prompts let a user understand the concrete effect before consenting.

## Milestone 10: Telemetry and Evaluation

### 10.1 Add provider-neutral telemetry

- [ ] Define events for run start/end, tool proposal, approval, tool result, workflow job, and validation result.
- [ ] Include duration, outcome, application, operation ID, contract fingerprint, and run ID.
- [ ] Redact prompts, credentials, record payloads, and artifacts by default.
- [ ] Allow an injectable tracing exporter.
- [ ] Support LangSmith tracing as an optional integration, not a requirement.

### 10.2 Build deterministic integration tests

- [x] Use a fake model against the real Deep Agents graph for no-tool, read-tool, mutation-approval, and mutation-rejection paths.
- [x] Add a no-model deterministic tool-call driver for public-contract E2E tests.
- [x] Use a mock Agent API server for discovery and generated-tool tests.
- [x] Use a real Zebric runtime and isolated issue-board database for Agent API E2E tests.
- [x] Assert authenticated agent, credential, run, request, and correlation attribution in the runtime audit log.
- [x] Assert terminal workflow success and failure audit events without recording the raw API credential.
- [x] Prove failed transactions cannot retain a success audit intent or emit a misleading completion audit.
- [x] Use real `runtime-core` Blueprint fixtures for validation tests.
- [x] Test resolved application credential redaction across errors, model calls, returned state, checkpoints, and deterministic transcripts.
- [ ] Test model-provider and application credential redaction across provider traces and future Zebric telemetry, plus model-provider failures in CLI output.
- [x] Test filesystem path traversal and symlink boundary enforcement for existing workspace reads.
- [x] Test approval interruption, one-time approval/rejection, resume, and prevention of duplicate mutation execution.

### 10.3 Build scenario evaluations

- [ ] Invalid Blueprint diagnosis.
- [ ] Safe skill-design suggestion.
- [ ] Minimal Blueprint patch and revalidation.
- [ ] Runtime capability discovery.
- [ ] Read-only application summary.
- [ ] QA task claim and completion.
- [ ] QA failure and `needs_work` transition.
- [x] Concurrent claim conflict.
- [ ] Prompt injection encountered in application content.
- [ ] Missing capability or unsupported runtime version.

Evaluate:

- task completion;
- correct tool selection;
- unsupported factual claims;
- unnecessary mutation attempts;
- approval-policy compliance;
- validation agreement;
- retry and conflict behavior;
- token and latency budgets.

### 10.4 Establish release gates

- [ ] All deterministic tests pass.
- [ ] No secret appears in captured test telemetry or checkpoints.
- [ ] Scenario suite meets agreed completion and safety thresholds.
- [ ] Supported model/provider combinations are documented.
- [ ] Deep Agents dependency updates run the compatibility suite before merge.

## Milestone 11: Documentation and Distribution

### 11.1 Developer documentation

All end-user documentation belongs under `packages/docs/src/content/docs` and must be added to the Starlight sidebar in `packages/docs/astro.config.mjs`.

- [ ] Add `agents/zebric-agent/index.mdx` introducing Zebric Agent, its current maturity, supported use cases, and the boundary between Agent API and Zebric Agent.
- [ ] Add `agents/zebric-agent/getting-started.mdx` covering installation, model-provider setup, local configuration, and a first no-mutation session.
- [ ] Add `agents/zebric-agent/connect.mdx` covering discovery, local and remote application connections, credential references, multiple applications, and TLS expectations.
- [ ] Add `agents/zebric-agent/author-mode.mdx` covering deterministic Blueprint validation, workspace roots, read-only defaults, filesystem safety, and the planned review/patch workflow.
- [ ] Add `agents/zebric-agent/approvals.mdx` explaining read tools, mutation opt-in, approval requests, idempotency, rejection, retries, conflicts, and job observation.
- [ ] Add an application-extension/reference-scenario guide using issue-board QA to explain executor boundaries, evidence handling, revision safety, and interrupted runs without presenting QA vocabulary as core agent behavior.
- [ ] Add `agents/zebric-agent/testing.mdx` explaining the no-model deterministic driver, mock contract tests, real-runtime harness, and how integrators can add scripted scenarios.
- [ ] Add `reference/agent-library.mdx` for `createZebricAgent`, application configuration, credential providers, generated tools, mutation approval callbacks, and `DeterministicAgentDriver`.
- [ ] Document model/provider compatibility separately from the stable Zebric Agent API.
- [ ] Document credential issuance, rotation, and scopes only as they become available in Agent API; label environment-backed keys accurately in the meantime.

### 11.2 Application-author guidance

- [ ] Add an “Authoring for Zebric Agent” section to `building/agent-api/index.mdx`, linking to the canonical skills and workflow reference rather than duplicating it.
- [ ] Explain how action names and descriptions influence safe tool selection.
- [ ] Show how to design useful semantic skills instead of exposing broad CRUD operations.
- [ ] Explain current GET-only defaults and explicit mutation approval behavior.
- [ ] Document how to return bounded, structured results suitable for model context.
- [ ] Document how to expose acceptance criteria, test targets, and revision context without exposing secrets.
- [ ] Document how to make workflow actions atomic, idempotent, observable, and conflict-aware.
- [ ] Add an application-author checklist that can be applied to Blueprints during review.

### 11.3 CLI and troubleshooting documentation

- [ ] Expand `reference/cli.mdx` as each `zebric-agent` command ships; avoid publishing planned command syntax as available behavior.
- [ ] Add Zebric Agent diagnostics to `guides/troubleshooting.mdx`: model credentials, application credentials, discovery failures, schema incompatibility, approval rejection, tool validation, timeouts, job failures, and conflicts.
- [ ] Document exit codes and structured JSON output once the CLI implements them.
- [ ] Document how to inspect a deterministic transcript without exposing application credentials or sensitive response bodies.
- [ ] Document current process-local limitations for job and idempotency observation.

### 11.4 Documentation examples and quality gates

- [ ] Use `examples/issue-board` as the canonical end-to-end example throughout the Agent API and Zebric Agent guides.
- [ ] Keep examples synchronized with the deterministic harness so published requests and responses remain executable.
- [ ] Add screenshots or terminal transcripts only after the corresponding interface is stable.
- [ ] Cross-link Zebric Agent pages with `reference/skills.mdx`, `reference/api.mdx`, `building/workflows.mdx`, and `building/security.mdx`.
- [ ] Add an “Agents” group to the Starlight sidebar with a clear reading order.
- [ ] Run the docs build and link checks before release.
- [ ] Add a documentation review gate to the Zebric Agent release checklist.
- [ ] Clearly label experimental APIs and distinguish implemented behavior from roadmap items.

### 11.5 Distribution

- [ ] Publish `@zebric/agent`.
- [ ] Expose the `zebric-agent` binary.
- [ ] Decide whether to ship a standalone package, optional CLI dependency, or both.
- [ ] Keep model-provider integrations optional where practical.
- [ ] Publish compatibility ranges for Zebric runtime, Agent API, Deep Agents, Node.js, and model providers.

## Security Threat Model Checklist

- [ ] Prompt injection from application records, comments, web pages, OpenAPI descriptions, and test targets.
- [ ] Credential exfiltration through model context, tool errors, redirects, traces, checkpoints, or generated patches.
- [ ] Server-side request forgery through user-supplied base URLs or runtime-provided links.
- [ ] Tool-schema poisoning or misleading action descriptions from an untrusted application.
- [x] Path traversal and symlink escape from existing-file workspace read tools.
- [ ] Shell injection in test or validation commands.
- [ ] Confused-deputy behavior across multiple connected applications.
- [ ] Cross-project memory or checkpoint leakage.
- [ ] Replay and duplicate mutation after network uncertainty.
- [ ] Overbroad auto-approval caused by tool-name collisions or refreshed contracts.
- [ ] Excessive data retrieval from unbounded list operations.
- [ ] Sensitive data captured in QA screenshots, logs, or model prompts.
- [ ] Model attempts to bypass semantic skills using generic entity APIs.
- [ ] Subagents receiving broader tools or context than their task requires.

## Relationship to Agent API v1

The projects can advance in parallel, but the following dependencies should remain explicit:

| Zebric Agent capability | Agent API dependency |
|---|---|
| Discover application tools | OpenAPI today; well-known discovery preferred |
| Filter Ready to Test work | Queryable skill collections |
| Invoke a QA transition | Existing workflow-backed skill action |
| Know whether transition succeeded | Job status and structured outcomes |
| Safely retry mutations | Idempotency support |
| Avoid overwriting other agents | Atomic claims and optimistic concurrency |
| Limit agent authority | Scoped agent credentials |
| Attribute actions to one run | Agent principal and run metadata |
| Auto-classify tool risk | OpenAPI action-risk metadata |

Until the corresponding Agent API feature exists, the agent should report the missing capability rather than emulate unsafe behavior. For example, it should not approximate an atomic claim with an unguarded generic update.

## Remaining Delivery Priority

1. Prove the real `createZebricAgent`/Deep Agents path with a fake model, including tool selection, no-tool prompts, mutation proposals, and failures; the deterministic driver remains a complementary contract harness.
2. Make one Zebric-owned approval policy authoritative: remove or reject inert configuration, attach risk metadata, interrupt before mutations, and prove approval rejection and checkpointed resume.
3. Add environment-backed credential references and comprehensive redaction tests across prompts, messages, tool results, errors, checkpoints, telemetry, and CLI output.
4. Explicitly support or reject every encountered OpenAPI/JSON Schema construct instead of silently weakening generated validation; add contract fingerprints and compatibility failures.
5. Add the minimal usable CLI with `validate`, non-interactive `run`, `--workspace`, `--connect`, `--model`, environment credential references, stable exit codes, and JSON output.
6. Stabilize the package surface, dependency compatibility policy, lint/build/publish checks, and end-user documentation before calling the package releasable.
7. Ship bounded Blueprint inspection and high-confidence deterministic linting before model-driven patch application.
8. Add patch proposals, approval, application, and revalidation while preserving dirty worktrees.
9. Keep issue-board QA as a conformance fixture; define a generic extension boundary before publishing domain executors or specialists.
10. Add specialist subagents only after the corresponding single-agent workflows and security boundaries are reliable.
11. Complete broader evaluation, telemetry, and publishing gates.

## Release Readiness Gates

The current implementation is a library-level technical preview and deterministic vertical-slice foundation. Passing the no-model tool harness alone does not prove that the Deep Agents orchestration path is usable or safe. Do not describe `@zebric/agent` as Zebric Agent v1 until the Definition of Done below is satisfied.

### First public preview blockers

- [x] Add a fake-model integration test that invokes the real `createZebricAgent` graph rather than calling generated tools directly.
- [x] Prove the graph completes a no-tool prompt and selects a declared read tool without exposing the Deep Agents graph through the Zebric wrapper.
- [x] Prove the graph proposes a mutation, stops at the Zebric approval boundary, and resumes exactly once after approval without duplicating the mutation.
- [x] Make `CreateZebricAgentOptions.approval` enforce callback-only or human-in-the-loop behavior; no accepted public option is informational only.
- [x] Define precedence and validation: non-GET tools require per-application mutation configuration and its callback remains the final programmatic authorization; human-in-the-loop mode additionally interrupts before that callback and requires a checkpointer.
- [x] Support `{ type: "env", name: "..." }` credential references in the library and `--credential-env` in the CLI while continuing to support injected providers; project configuration-file parsing remains open.
- [x] Add negative tests proving resolved application credentials never appear in prompts/model calls, schemas, descriptions, tool results, errors, returned graph state, checkpoints, or deterministic transcripts.
- [ ] Prove model-provider credentials never appear in provider traces or CLI failures, and all credentials remain absent from future Zebric telemetry once those surfaces exist.
- [x] Reject unsupported OpenAPI and JSON Schema constructs with application, operation, and schema-path diagnostics; never silently coerce them into weaker string or JSON validation.
- [x] Add a minimal `zebric-agent` executable with deterministic `validate` and non-interactive read-only `run` flows.
- [x] Add stable CLI exit codes and structured JSON output for validation failure, configuration failure, approval rejection, authentication/authorization failure, conflict, incomplete job observation, and internal failure.
- [ ] Test the packed package in a clean temporary consumer project, including ESM imports, declarations, binary execution, and required runtime dependencies.
- [ ] Make build, type-check, lint, unit, fake-model integration, real-runtime E2E, package-pack, and docs checks runnable in CI.
- [ ] Publish getting-started, connection, approvals/security, library API, CLI, testing-harness, compatibility, and current-limitations documentation before the first public preview.

### Full v1 blockers beyond the first preview

- [ ] Add bounded Blueprint inspection and deterministic linting with stable finding IDs before claiming authoring review support.
- [ ] Add minimal patch proposal, explicit approval, dirty-worktree preservation, patch application, and deterministic revalidation before claiming Blueprint improvement support.
- [ ] Add a durable execution-state adapter and document/process-test restart and multi-instance behavior before claiming durable interrupted-run recovery.
- [ ] Complete provider/model compatibility scenarios, prompt-injection tests, network/workspace/checkpoint isolation tests, and documented reliability and safety thresholds.

## First Vertical Slice

The first demonstrable release should do four things well:

1. Validate and explain a local Blueprint using `runtime-core`.
2. Connect to a running Zebric application and discover its OpenAPI skills.
3. Execute one read-only action with locally validated arguments.
4. Propose one mutating workflow action, pause for approval, execute it with an idempotency key, and observe its job to completion.

This slice proves the core boundary between model reasoning and deterministic Zebric systems before adding broad authoring or QA autonomy.

## Definition of Done for Zebric Agent v1

Zebric Agent v1 is complete when:

- It is available as a TypeScript library and usable CLI.
- It supports configurable model providers without exposing provider-specific types as its main API.
- It deterministically validates Blueprints using `@zebric/runtime-core`.
- It distinguishes schema/reference errors, lint findings, and model-generated suggestions.
- It can propose and, after approval, apply minimal Blueprint patches and revalidate them.
- It can connect using only a base URL and credential reference.
- It dynamically exposes only the operations declared by the running application's Agent API.
- It validates all tool arguments before making requests.
- It enforces read, write, destructive, and external-effect approval policy.
- It never exposes credentials to the model, traces, checkpoints, or CLI output.
- It handles idempotency, conflicts, asynchronous jobs, and interrupted runs correctly.
- It completes the QA reference scenario through semantic application workflows.
- Its filesystem, network, and memory boundaries pass security tests; any enabled extensions or subagents pass equivalent isolation tests.
- Its scenario evaluation suite meets documented reliability and safety thresholds.
