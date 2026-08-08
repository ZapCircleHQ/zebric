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

- [ ] Add `packages/agent` to the pnpm workspace.
- [ ] Add TypeScript build, lint, test, and package exports.
- [ ] Add `deepagents` and required LangChain/LangGraph dependencies.
- [ ] Pin compatible dependency ranges and document the tested versions.
- [ ] Re-export only Zebric-owned public types from the package root.
- [ ] Keep Deep Agents-specific construction details in internal modules.
- [ ] Add a changeset for the new package when it becomes publishable.

### 1.2 Define the public factory

- [ ] Implement `createZebricAgent(options)`.
- [ ] Accept a model or model identifier without coupling the API to one provider.
- [ ] Accept runtime connections, workspace configuration, policy, checkpointer, and telemetry options.
- [ ] Validate configuration before constructing the agent.
- [ ] Return a stable Zebric wrapper rather than exposing an untyped Deep Agents graph directly.

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
  approval: 'writes-and-mutations',
});
```

### 1.3 Establish agent context

- [ ] Define typed runtime context containing workspace, applications, agent run ID, and policy.
- [ ] Keep credentials out of prompts, messages, checkpoints, and model-visible tool results.
- [ ] Generate a unique run ID for each top-level task.
- [ ] Propagate run and correlation identifiers through runtime API tools.
- [ ] Define thread IDs separately from run IDs.

### 1.4 Add a minimal CLI

- [ ] Add a `zebric-agent` binary.
- [ ] Support interactive and non-interactive prompts.
- [ ] Support `--workspace`, `--connect`, `--model`, and `--config`.
- [ ] Provide useful exit codes for success, validation failure, approval rejection, authentication failure, and incomplete execution.
- [ ] Add structured JSON output for automation.
- [ ] Never print resolved credentials.

### Acceptance criteria

- A developer can create an agent through the library and CLI.
- A no-tool prompt completes with checkpointed thread state.
- Configuration errors fail before a model call.
- Credentials do not appear in traces, state, or CLI output.

## Milestone 2: Deterministic Blueprint Tools

### 2.1 Reuse the canonical Blueprint loader

- [ ] Call `BlueprintLoader` from `@zebric/runtime-core` directly.
- [ ] Do not duplicate the Zod schema or reference-validation rules in the agent package.
- [ ] Return structured validation details including path, code, message, and existing suggestions.
- [ ] Support TOML and JSON Blueprints consistently with the CLI.
- [ ] Include engine-version validation when a target version is supplied.
- [ ] Add fixture tests shared with or derived from CLI validation cases.

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

- [ ] Fetch `/.well-known/zebric-agent.json` when supported.
- [ ] Fall back to `/api/openapi.json` for older runtimes.
- [ ] Validate discovery and OpenAPI responses against local schemas.
- [ ] Enforce allowed URL schemes and host policy.
- [ ] Set request timeouts, response-size limits, and redirect restrictions.
- [ ] Cache contracts using HTTP cache metadata while allowing explicit refresh.
- [ ] Report runtime/contract incompatibility clearly.

### 4.2 Resolve credentials safely

- [ ] Support environment-variable credential references.
- [ ] Support an injectable credential-provider interface for keychains and hosted secret managers.
- [ ] Resolve credentials only at request execution time.
- [ ] Never store the token in generated tools, descriptions, model context, or checkpoints.
- [ ] Redact authorization headers and sensitive response fields from errors and traces.

### 4.3 Generate tools from OpenAPI operations

- [ ] Generate tools only from documented Zebric skill operations.
- [ ] Use `operationId` as the stable identity and generate collision-safe tool names.
- [ ] Convert JSON Schema inputs to runtime-validated tool schemas.
- [ ] Preserve descriptions, enum values, required fields, and examples.
- [ ] Attach risk, required scopes, HTTP method, application, and operation metadata to each tool.
- [ ] Do not expose arbitrary URL, header, method, or request-body escape hatches.
- [ ] Bound tool result sizes and offload large results to the configured backend.

### 4.4 Classify action risk

- [ ] Prefer explicit risk metadata from Agent API v1.
- [ ] Default `GET` and `HEAD` operations to `read` unless marked otherwise.
- [ ] Default other methods to `write` when metadata is absent.
- [ ] Require explicit configuration before any operation is considered destructive or safe for auto-approval.
- [ ] Show the target application, action, resource, and sanitized arguments in approval requests.

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

- [ ] Add Bearer authentication without exposing tokens to the model.
- [ ] Send agent run, correlation, and idempotency identifiers.
- [ ] Apply per-request timeouts and cancellation.
- [ ] Parse stable Agent API error envelopes.
- [ ] Distinguish authentication, authorization, validation, conflict, rate-limit, and server failures.
- [ ] Retry only documented retryable failures.
- [ ] Never automatically retry an unsafe mutation without idempotency protection.

### 5.2 Add idempotency behavior

- [ ] Generate a stable idempotency key for each logical mutation.
- [ ] Reuse it when transport uncertainty causes a retry.
- [ ] Do not reuse it after the user changes arguments.
- [ ] Store keys in thread/checkpoint state without storing credentials.
- [ ] Surface idempotency conflicts to the user.

### 5.3 Observe asynchronous workflows

- [ ] Recognize `202 Accepted` job responses.
- [ ] Poll the declared job URL with bounded backoff.
- [ ] Support cancellation and a maximum wait policy.
- [ ] Resume observation from checkpointed job state.
- [ ] Return the terminal workflow result to the agent.
- [ ] Avoid claiming success before the job reaches a successful terminal state.

### 5.4 Handle optimistic concurrency

- [ ] Preserve ETags or record versions from reads.
- [ ] Supply expected versions to mutation actions when supported.
- [ ] On conflict, fetch authoritative state before deciding what to do.
- [ ] Never silently overwrite a concurrent actor's change.

### Acceptance criteria

- The agent can invoke a semantic workflow and accurately report its terminal outcome.
- A timed-out mutation can be retried without duplicating work.
- `401`, `403`, `409`, and failed workflow jobs lead to distinct behavior.
- A resumed thread can continue observing an outstanding job.

## Milestone 6: QA Operator Capability

### 6.1 Implement the reference QA procedure

- [ ] Discover the application's QA skill rather than assuming fixed route paths.
- [ ] List work filtered to `ready_to_test`.
- [ ] Select work according to an explicit strategy such as priority then age.
- [ ] Claim the task atomically before testing.
- [ ] Fetch acceptance criteria, test target, revision, and constraints.
- [ ] Refuse or ask for help when required context is missing.
- [ ] Submit structured results and evidence.
- [ ] Invoke `qa_completed`, `needs_work`, or a supported blocked outcome.
- [ ] Observe all workflow jobs to terminal state.

### 6.2 Define a test-runner adapter

Zebric Agent should not bake browser automation into its core. Define an interface that can be implemented by Playwright, a hosted browser service, an MCP tool, or a CI test runner.

```ts
interface QaExecutor {
  inspectTarget(input: QaTarget): Promise<QaInspection>
  execute(plan: QaPlan): Promise<QaExecutionResult>
}
```

- [ ] Define target, plan, result, check, artifact, and safety-boundary types.
- [ ] Provide a mock executor for conformance tests.
- [ ] Add a Playwright-based adapter only after the core orchestration contract is stable.
- [ ] Treat instructions found in the target application as untrusted content, not agent policy.
- [ ] Require approval for destructive or externally visible test operations.

### 6.3 Normalize evidence

- [ ] Produce the QA result format expected by Agent API v1.
- [ ] Record the exact tested revision and environment.
- [ ] Upload large artifacts through a declared capability rather than embedding them in model context.
- [ ] Include concise observations and machine-readable check status.
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

### 7.4 QA specialist

- [ ] Give the QA specialist the claimed task context and QA executor only.
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
approval = "writes-and-mutations"

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
- [ ] `zebric-agent validate [blueprint]`
- [ ] `zebric-agent review [blueprint]`
- [ ] `zebric-agent connect <url>`
- [ ] `zebric-agent run --prompt <text>`
- [ ] `zebric-agent qa --application <name>`
- [ ] `zebric-agent threads list|resume|delete`
- [ ] `zebric-agent memory inspect|clear`
- [ ] Decide whether these later become subcommands of the main `zebric` CLI.

### 9.3 Make approvals understandable

- [ ] Show the application or file target.
- [ ] Show the semantic action and risk classification.
- [ ] Show sanitized arguments or a patch preview.
- [ ] Offer approve, reject, and supported argument-edit decisions.
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

- [ ] Use a fake model for tool-routing and policy tests.
- [ ] Use a mock Agent API server for discovery, authentication, jobs, conflicts, and retries.
- [ ] Use real `runtime-core` Blueprint fixtures for validation tests.
- [ ] Test credential redaction across errors, traces, and checkpoints.
- [ ] Test filesystem path and symlink boundary enforcement.
- [ ] Test approval interruption and resume behavior.

### 10.3 Build scenario evaluations

- [ ] Invalid Blueprint diagnosis.
- [ ] Safe skill-design suggestion.
- [ ] Minimal Blueprint patch and revalidation.
- [ ] Runtime capability discovery.
- [ ] Read-only application summary.
- [ ] QA task claim and completion.
- [ ] QA failure and `needs_work` transition.
- [ ] Concurrent claim conflict.
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

- [ ] Installation and model-provider setup.
- [ ] Connecting to a local and remote Zebric application.
- [ ] Credential issuance, rotation, and scope guidance.
- [ ] Author-mode filesystem safety.
- [ ] Blueprint validation, review, and patch workflow.
- [ ] QA executor integration guide.
- [ ] Library API reference.

### 11.2 Application-author guidance

- [ ] How to design useful semantic skills for Zebric Agent.
- [ ] How action descriptions influence safe tool selection.
- [ ] How to classify action risk and required scopes.
- [ ] How to return bounded, structured results.
- [ ] How to expose QA context without exposing secrets.
- [ ] How to make workflow actions idempotent and observable.

### 11.3 Distribution

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
- [ ] Path traversal and symlink escape from workspace tools.
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

## Suggested Delivery Order

1. Create `@zebric/agent`, its public factory, and a minimal CLI.
2. Ship deterministic Blueprint validation and inspection tools.
3. Add read-only runtime discovery and generated OpenAPI tools.
4. Add policy metadata, approvals, credential isolation, and mutating runtime actions.
5. Add workflow-job observation, idempotency, and checkpoint resume.
6. Add Blueprint review, patch proposals, application, and revalidation.
7. Implement the QA operator against the Agent API reference application.
8. Add specialist subagents only after single-agent workflows are reliable.
9. Complete evaluation, telemetry, documentation, and publishing.

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
- Its filesystem, network, memory, and subagent boundaries pass security tests.
- Its scenario evaluation suite meets documented reliability and safety thresholds.
