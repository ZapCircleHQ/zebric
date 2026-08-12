# Agent API v1 Implementation Tasks

## Goal

Make a running Zebric application safely and reliably drivable by an external agent.

An agent should be able to discover the application's supported capabilities, authenticate with a scoped identity, find relevant records, invoke domain workflows, observe their outcomes, and leave a complete audit trail without manipulating the HTML interface or knowing the Blueprint in advance.

The first reference scenario is an issue tracker in which an agent:

1. Finds tasks in `ready_to_test`.
2. Atomically claims one for QA.
3. Reads its acceptance criteria and test context.
4. Tests the feature using an external browser or test runner.
5. Submits structured results and evidence.
6. Moves the task to `needs_work` or `qa_completed` through a Zebric workflow.

Zebric coordinates the work and owns the state transitions. The external agent or its tools exercise the application under test.

## Existing Foundation

Zebric already provides a useful starting point:

- Blueprints can declare agent-facing skills and actions.
- Skill actions can map to entity operations or workflows.
- The Node runtime registers skill routes.
- API keys can authenticate requests with a Bearer token.
- `GET /api/openapi.json` generates an OpenAPI 3.1 document.
- Entity mutations trigger entity workflows.
- Workflow invocations return a job ID.
- Correlation and request IDs are propagated into workflow execution.
- The Dispatch example demonstrates an agent-accessible issue-management API.

Agent API v1 should harden and complete this model rather than introduce a separate execution system.

## Design Principles

- **Declare capabilities, not unrestricted access.** Blueprints explicitly expose the safe operations an agent may invoke.
- **Prefer semantic actions over generic CRUD.** Actions such as `claim_for_qa` and `complete_qa` preserve domain validation, workflow behavior, notifications, and auditing.
- **Keep business rules server-side.** Agents propose actions; Zebric validates state transitions and permissions.
- **Make every mutation attributable and retry-safe.** Agent identity, run identity, idempotency, and concurrency checks are part of the runtime contract.
- **Use OpenAPI as the canonical contract.** MCP and other transports may be generated later from the same capability definitions.
- **Return structured, stable outcomes.** Agents should not need to parse HTML or error strings.
- **Fail closed.** Undeclared parameters, unavailable actions, stale state, and insufficient scopes must not silently succeed.

## V1 Scope Boundary

Agent API v1 is the secure HTTP contract implemented first by `runtime-node`: discovery, typed semantic skills, scoped identity, attributable/idempotent mutations, observable jobs, atomic state transitions, stable errors, and auditability. Cloudflare Workers execution parity, event streaming, generated MCP, durable multi-instance job storage, and advanced credential protocols are follow-on capabilities. The v1 contract should leave room for them without making them prerequisites for a useful Node release.

## Target Runtime Contract

A conforming application exposes:

```text
GET  /.well-known/zebric-agent.json
GET  /api/openapi.json
GET  /api/jobs/{jobId}
```

The QA reference application additionally declares semantic routes such as:

```text
GET  /api/qa/tasks?status=ready_to_test
GET  /api/qa/tasks/{id}
POST /api/qa/tasks/{id}/claim
POST /api/qa/tasks/{id}/report-result
POST /api/qa/tasks/{id}/complete
POST /api/qa/tasks/{id}/needs-work
```

All protected calls use a scoped agent credential. Mutations accept an idempotency key and return either a completed result or a job that can be observed to a terminal state.

## Milestone 1: Queryable Skill Collections

### 1.1 Extend the Blueprint skill-action schema

- [x] Add a `query` declaration to `SkillAction`.
- [x] Support typed query parameters using existing field types.
- [x] Support enum values, required parameters, defaults, and descriptions.
- [x] Distinguish filtering parameters from pagination and cursor parameters.
- [ ] Reject query declarations on incompatible action types.
- [ ] Validate that filter fields exist on the referenced entity unless explicitly mapped.
- [x] Add TOML parsing and schema-validation tests.

Proposed shape:

```toml
[[skill.qa.actions]]
name = "list_tasks"
description = "List tasks available to the QA agent."
method = "GET"
path = "/api/qa/tasks"
entity = "Task"
action = "list"

[skill.qa.actions.query.status]
type = "Enum"
values = ["ready_to_test", "testing"]
required = false

[skill.qa.actions.query.projectId]
type = "Ref"
required = false
```

### 1.2 Implement bounded server-side filtering

- [x] Parse only query parameters declared by the skill action.
- [x] Coerce and validate values according to their declared types.
- [x] Translate valid parameters into the query executor's `where` clause.
- [ ] Return `400` with a stable error body for invalid or undeclared parameters.
- [x] Preserve entity permission checks for filtered queries.
- [ ] Add limits for filter count, page size, and supported operators.
- [x] Prevent arbitrary field/operator injection.
- [ ] Add runtime tests covering exact matches, enums, invalid values, permissions, limits, and empty results.

### 1.3 Improve pagination

- [x] Retain bounded `limit` support.
- [ ] Define a stable pagination response envelope.
- [ ] Add opaque cursor pagination, or document offset pagination as the v1 contract.
- [ ] Include `nextCursor` or equivalent continuation data.
- [ ] Define deterministic default ordering with a unique tie-breaker.

Suggested response:

```json
{
  "items": [],
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

### Acceptance criteria

- An agent can request only tasks with `status=ready_to_test` without downloading the entire entity collection.
- The generated OpenAPI document fully describes every supported filter.
- Invalid fields and enum values produce deterministic `400` errors.
- Results remain subject to the caller's entity permissions.

## Milestone 2: Observable Workflow Outcomes

### 2.1 Add a public job-status API

- [x] Add `GET /api/jobs/{jobId}`.
- [x] Require the caller to own the job.
- [ ] Add an explicit administrative scope for cross-owner job inspection.
- [x] Return pending, running, succeeded, failed, and cancelled states.
- [x] Include workflow name, timestamps, and a sanitized error.
- [ ] Persist or retain completed jobs for a documented period.
- [x] Return `404` for missing or inaccessible jobs without leaking their existence.

Suggested response:

```json
{
  "id": "job_123",
  "status": "succeeded",
  "workflow": "CompleteQA",
  "createdAt": "2026-08-07T20:00:00Z",
  "completedAt": "2026-08-07T20:00:01Z",
  "result": {
    "taskId": "task_456",
    "previousStatus": "testing",
    "status": "qa_completed"
  },
  "error": null
}
```

### 2.2 Define workflow results

- [ ] Allow a workflow to declare or produce a structured result.
- [x] Store that result on successful completion.
- [ ] Validate declared result schemas where present.
- [ ] Sanitize results so secrets and internal workflow state are not exposed.
- [ ] Document whether workflows are asynchronous by default.
- [ ] Consider an explicit `execution = "sync" | "async"` action setting for later compatibility.

### 2.3 Standardize workflow invocation responses

- [x] Return `202 Accepted` for asynchronous workflow actions.
- [x] Include a job URL in the response and `Location` header.
- [ ] Include the request and correlation IDs.
- [x] Add OpenAPI schemas for accepted jobs and completed results.

### Acceptance criteria

- After invoking a QA transition, an agent can determine whether it actually succeeded.
- Failed preconditions and execution failures are distinguishable.
- One agent cannot inspect another agent's jobs without permission.

## Milestone 3: Concurrency and Retry Safety

### 3.1 Add idempotency support

- [x] Accept `Idempotency-Key` on agent mutations.
- [x] Scope keys by authenticated principal and application; fingerprint the HTTP method, resolved target, query, and body so cross-action or cross-resource reuse conflicts.
- [ ] Persist the request fingerprint and original response for a defined retention period. (The v1 slice currently retains these in memory for the runtime process.)
- [x] Return the original result for an identical retry.
- [x] Return `409` when a key is reused with a different payload.
- [x] Ensure workflow jobs are not enqueued twice.
- [ ] Redact idempotency records from logs and administrative output as appropriate.

### 3.2 Add optimistic concurrency

- [ ] Expose a record version or ETag on reads.
- [ ] Support `If-Match` or an explicit expected-version field on mutations.
- [ ] Return a structured `409 Conflict` when the record has changed.
- [x] Make workflow preconditions and record updates atomic where required.

### 3.3 Implement atomic claims

- [x] Provide a reference `ClaimTaskForQA` workflow.
- [x] Transition only from `ready_to_test` to `testing`.
- [ ] Record the claiming agent and claim time. (Agent attribution is recorded; claim time remains outstanding.)
- [x] Reject a second claim with `409`.
- [ ] Define claim expiration or explicit release behavior.
- [x] Ensure the claim state transition and completion audit intent are atomic through the database outbox.

### Acceptance criteria

- Two agents attempting to claim the same task cannot both succeed.
- Retrying a timed-out request cannot duplicate a workflow or audit event.
- Stale transitions produce a machine-readable conflict response.

## Milestone 4: Agent Identity and Authorization

### 4.1 Introduce first-class agent principals

- [x] Represent API callers as agent principals, retaining a user-shaped compatibility view only for existing permission rules.
- [x] Include agent ID, credential ID, display name, scopes, and declared tenant/project constraints in the principal.
- [x] Preserve compatibility with the existing session and permission infrastructure.
- [x] Make actor type and authenticated attribution available to workflows and audit templates.

### 4.2 Harden credentials

- [x] Store SHA-256 credential verifiers in the runtime registry instead of retaining plaintext API keys there.
- [ ] Support credential expiration, rotation, and revocation.
- [x] Identify credentials by stable credential ID without logging or retaining secret material in the registry.
- [ ] Add administrative tooling for issuing and revoking agent credentials.
- [ ] Document environment-based static keys as development-only or legacy behavior.
- [ ] Evaluate OAuth 2 client credentials or short-lived signed tokens after the scoped-key implementation.

### 4.3 Add scopes and resource constraints

- [x] Allow individual skill actions to declare required scopes.
- [x] Restrict credentials to selected skill actions.
- [ ] Support project, tenant, or entity-row constraints.
- [x] Include required scopes in OpenAPI operation metadata.
- [x] Return `401` for invalid credentials and `403` for insufficient scope.
- [x] Ensure generic entity APIs require explicit entity scopes and cannot bypass skill-level restrictions.

Example scopes:

```text
qa.list
qa.read
qa.claim
qa.report
qa.transition
comment.create
```

### Acceptance criteria

- A QA credential cannot delete tasks or invoke unrelated workflows.
- Revoked and expired credentials stop working immediately or within a documented cache window.
- Workflow and audit contexts identify the agent and credential responsible for the action.

## Milestone 5: Discovery and OpenAPI Contract

### 5.1 Enrich generated OpenAPI

- [x] Generate typed query parameters and enum values.
- [x] Mark required body properties correctly.
- [x] Generate schemas for workflow job and result responses.
- [x] Document idempotency headers.
- [ ] Generate stable error response schemas for `400`, `401`, `403`, `404`, `409`, `422`, `429`, and `500` where applicable.
- [ ] Include action preconditions and behavioral guidance in descriptions or extensions.
- [ ] Include examples for representative requests and responses.
- [ ] Represent per-action security requirements and scopes.
- [ ] Mark unauthenticated skills as having no security requirement.
- [ ] Add generator snapshot and conformance tests.

### 5.2 Add a well-known discovery document

- [x] Add `GET /.well-known/zebric-agent.json`.
- [x] Advertise the OpenAPI URL, authentication methods, skill names, and optional runtime capabilities.
- [x] Resolve URLs using the same trusted-origin logic as OpenAPI.
- [x] Add appropriate cache and CORS behavior.
- [x] Avoid exposing private Blueprint implementation details.

Example:

```json
{
  "name": "Acme Issue Tracker",
  "version": "1.0.0",
  "openapi": "/api/openapi.json",
  "authentication": [
    { "type": "bearer" }
  ],
  "skills": ["qa", "issues"],
  "capabilities": {
    "workflowJobs": true,
    "idempotency": true,
    "eventStream": false
  }
}
```

### 5.3 Stabilize error envelopes

- [ ] Define a common machine-readable error schema.
- [ ] Include a stable error code, safe message, request ID, and optional field details.
- [ ] Do not expose raw exceptions or secrets in production.
- [ ] Document which failures are retryable.

Suggested shape:

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Task is no longer ready to test.",
    "retryable": false,
    "details": {
      "currentStatus": "testing"
    },
    "requestId": "req_123"
  }
}
```

### Acceptance criteria

- An agent can connect with only the base URL and credential and discover all supported actions.
- The OpenAPI document is sufficient to construct valid calls without reading the Blueprint.
- Authentication, conflicts, validation errors, and workflow failures are machine distinguishable.

## Milestone 6: Auditability and Observability

### 6.1 Standardize agent attribution

- [x] Attach actor type, agent ID, credential ID, run ID, correlation ID, and request ID to Agent API skill mutations and workflow jobs.
- [x] Accept and validate a bounded `X-Agent-Run-ID` header for agent mutations.
- [x] Make authenticated agent, credential, run, correlation, and request metadata available to workflow steps.
- [x] Ensure automatic entity-triggered workflows retain the initiating actor.

### 6.2 Add operational telemetry

- [ ] Record action name, outcome, latency, and status code without recording secrets.
- [x] Trace an API request through workflow enqueueing and terminal completion or failure audit events.
- [ ] Add metrics for authorization failures, conflicts, retries, duplicate idempotency keys, and failed jobs.
- [ ] Provide administrators a way to inspect an agent run and its resulting mutations.

### Acceptance criteria

- A human can determine which agent changed a card, why, from which run, and through which workflow.
- Logs and traces correlate the initial API request with the terminal workflow outcome.

## Milestone 7: QA Reference Application

### 7.1 Model the required testing context

- [x] Add or extend a reference issue/task entity with:
  - acceptance criteria;
  - environment or preview URL;
  - build or commit identifier;
  - feature-flag context;
  - test-account or fixture reference;
  - required test suites;
  - known limitations;
  - destructive-testing boundaries.
- [x] Do not store raw test credentials in entity fields returned to agents; expose only an external fixture reference.
- [ ] Define a secure reference mechanism for external secret delivery if needed.

### 7.2 Model structured QA results

- [x] Add a QA result entity or equivalent immutable result record.
- [x] Record outcome, summary, individual checks, evidence references, tested revision, agent run, and creation timestamp.
- [ ] Support `passed`, `failed`, `blocked`, and optionally `inconclusive` checks.
- [ ] Validate evidence metadata and cap payload sizes.
- [ ] Store large screenshots and logs externally and retain references in Zebric.

### 7.3 Add semantic QA workflows

- [x] `ClaimTaskForQA`
- [ ] `ReportQAResult`
- [x] `CompleteQA`
- [x] `MarkNeedsWork`
- [ ] `ReleaseQAClaim` or claim expiration
- [x] Ensure implemented claim and terminal workflows validate allowed source state.
- [x] Ensure QA result creation and task transition commit or roll back together.
- [x] Include the audit intent in the same transactional boundary using a database outbox; deliver it to the existing audit log after commit with startup retry.

Transactional completion audit delivery is at least once. The outbox row is acknowledged only after the existing audit logger confirms its append, and each event has a stable `auditId` so downstream consumers can detect or deduplicate a replay. A rolled-back workflow cannot retain a completion intent; its terminal failure is logged after rollback.

### 7.4 Publish a QA skill

- [x] Declare list, get, claim, complete, and needs-work actions.
- [ ] Add report-only and release/expiration actions when their workflows are defined.
- [ ] Give each action specific descriptions and examples.
- [ ] Apply the minimum required scopes.
- [ ] Confirm all action schemas and outcomes appear correctly in OpenAPI.

### Acceptance criteria

- A general-purpose OpenAPI-capable agent can complete the reference scenario using only runtime discovery.
- The final card state, QA result, workflow job, and audit history agree.
- The task records the exact revision that was tested.

## Milestone 8: Agent Conformance Suite

### 8.1 Build an end-to-end harness

- [x] Start a real Zebric runtime with the QA reference Blueprint.
- [ ] Seed multiple projects and task states.
- [x] Provision reference credentials with different read, mutation, and seeding scopes.
- [x] Drive the runtime strictly through the published discovery and API surfaces.
- [x] Avoid importing internal runtime classes in the conformance client.

### 8.2 Cover the happy path

- [x] Discover the application and OpenAPI document.
- [x] Authenticate.
- [x] List only `ready_to_test` tasks.
- [x] Claim a task.
- [x] Read complete testing context.
- [x] Submit structured evidence.
- [x] Trigger `qa_completed`.
- [x] Observe the workflow to completion.
- [x] Verify task state and audit attribution.

### 8.3 Cover safety and failure cases

- [x] Two agents race concurrently to claim one task; exactly one claim succeeds.
- [x] A request is retried with the same idempotency key.
- [x] An idempotency key is reused with a different body.
- [x] An idempotency key is reused for a different resource and cannot replay the first resource's response.
- [x] A stale agent attempts a transition.
- [x] A credential lacks the required scope and cannot bypass it through generic CRUD.
- [ ] A credential is expired or revoked.
- [x] A workflow fails after enqueueing without emitting a misleading completion audit.
- [ ] Evidence is malformed or oversized.
- [ ] An agent attempts undeclared filters or body fields.
- [x] One agent attempts to read another agent's job.

### 8.4 Verify database and edge-runtime atomicity

Node SQLite/PostgreSQL behavior is part of the core v1 release gate. Workers items below are compatibility work and may follow v1 provided discovery accurately reports them as unsupported.

- [x] Prove SQLite rolls back the task transition when QA result creation fails.
- [x] Add live PostgreSQL commit and rollback integration scenarios.
- [x] Provision PostgreSQL in CI and run the live scenarios through `ZEBRIC_TEST_POSTGRES_URL`.
- [ ] Confirm the PostgreSQL scenarios pass in CI; the local development environment currently has no PostgreSQL server.
- [x] Replace the Cloudflare D1 adapter's non-atomic callback transaction shim with an explicit unsupported error.
- [x] Add a D1 `batch()` primitive and verify commit and rollback against Miniflare D1.
- [x] Classify transactional workflows deterministically as database-only and optionally D1-batch eligible.
- [x] Reject external effects such as webhooks, email, notifications, plugins, and delays inside database transactions.
- [x] Reject transactional Blueprints in `runtime-worker` until an atomic workflow executor is available.
- [ ] Add Agent API skill and workflow execution support to `runtime-worker`; it currently exposes the core HTTP/CRUD adapter only.
- [ ] Compile eligible database-only transactional workflows into one D1 batch, rejecting workflows that require intermediate query results, external effects, delays, loops, or unsupported control flow.
- [ ] Consider a SQLite-backed Durable Object execution adapter for general interactive transactions and per-application serialization.
- [x] Advertise Node transactional-workflow support through discovery metadata.
- [ ] Add Agent API discovery to `runtime-worker` and advertise D1/Workers transaction limitations there.

### Acceptance criteria

- The conformance suite runs in CI.
- It verifies behavior through public contracts rather than implementation details.
- Failures clearly identify contract regressions.

## Post-v1 Extensions: Events and MCP Adapter

These are follow-on capabilities and are not required to ship the core Agent API v1.

### 9.1 Event delivery

- [ ] Define versioned domain event envelopes.
- [ ] Support authenticated outbound webhooks first.
- [ ] Add delivery IDs, signatures, retries, and replay protection.
- [ ] Consider server-sent events or queue adapters for long-running agents.
- [ ] Support cursor-based replay where event retention permits it.
- [ ] Treat events as notifications; require agents to fetch authoritative state before mutating it.

Candidate events:

```text
task.entered_ready_to_test
task.qa_claimed
task.changed_during_qa
task.qa_claim_expired
workflow.completed
workflow.failed
```

### 9.2 Generated MCP server

- [ ] Map Blueprint skill actions to MCP tools.
- [ ] Reuse the same authentication, authorization, validation, idempotency, and audit paths as HTTP actions.
- [ ] Generate tool descriptions and schemas from the canonical capability metadata.
- [ ] Keep OpenAPI and MCP behavior contract-equivalent.
- [ ] Do not create a second workflow execution implementation.

## Cross-Cutting Engineering Tasks

### Compatibility and rollout

- [ ] Preserve existing skill definitions where practical.
- [ ] Decide whether list response envelopes require a versioned route or compatibility mode.
- [ ] Add deprecation notices before changing existing entity API behavior.
- [ ] Add changesets for affected published packages.
- [ ] Document the minimum runtime version for Agent API v1 features.

### Documentation

All end-user documentation belongs under `packages/docs/src/content/docs` and must be added to the Starlight sidebar in `packages/docs/astro.config.mjs`.

#### Agent API guide

- [ ] Add `building/agent-api/index.mdx` explaining what makes a Zebric application agent-drivable and when to expose a skill instead of generic entity CRUD.
- [ ] Add `building/agent-api/skills.mdx` with complete Blueprint examples for read actions, typed query filters, entity actions, and workflow-backed semantic mutations.
- [ ] Add `building/agent-api/workflow-actions.mdx` covering preconditions, atomic conditional updates, `202 Accepted`, job observation, conflicts, and idempotent retries.
- [ ] Add `building/agent-api/security.mdx` covering API keys, current limitations, least authority, CSRF behavior, credential handling, action descriptions, and unsafe exposure patterns.
- [ ] Add a design checklist for semantic actions, bounded inputs/results, safe state transitions, and useful descriptions.

#### Agent API reference

- [ ] Expand `reference/skills.mdx` with the `query` schema, supported parameter types, `field` mapping, defaults, required values, enum constraints, pagination behavior, and validation errors.
- [ ] Expand `reference/api.mdx` with `/.well-known/zebric-agent.json`, `/api/openapi.json`, workflow action responses, `/api/jobs/{id}`, `Idempotency-Key`, and `409` behavior.
- [ ] Document the discovery document fields and capability flags, including how clients must treat a capability reported as `false`.
- [ ] Document the workflow-job response schema and ownership rules.
- [ ] Add a status-code and error-behavior table for authentication, authorization, validation, missing resources, stale transitions, and server failures.
- [ ] Document which Agent API state is currently process-local, especially workflow jobs and idempotency records.

#### Tutorials and examples

- [ ] Add `guides/agent-ready-issue-board.mdx` that incrementally extends `examples/issue-board` rather than replacing its existing Blueprint.
- [ ] Walk through stable workflow keys, QA context fields, `qaState`, filtered read actions, and `ClaimIssueForQA`.
- [ ] Add copyable curl commands for discovery, listing Ready to Test work, claiming a task, retrying with the same idempotency key, and observing the job.
- [ ] Show expected successful, idempotent-retry, and conflict responses.
- [ ] Clearly separate Zebric's orchestration responsibilities from browser automation and test-runner responsibilities.
- [ ] Link the guide to the source Blueprint and deterministic E2E harness.

#### Operations and troubleshooting

- [ ] Add Agent API credential provisioning to `building/security.mdx`, clearly separating current environment-backed API keys from planned scoped credentials and rotation support.
- [ ] Add Agent API diagnostics to `guides/troubleshooting.mdx`: missing key environment variables, `401`, `403`, CSRF mistakes, undiscoverable actions, invalid filters, `409`, failed jobs, and expired process-local job state.
- [ ] Add runtime deployment notes to `run/runtime.mdx` for trusted origins, HTTPS, secret injection, job retention limitations, and multi-instance limitations.
- [ ] Document database transaction support: Node SQLite, Node PostgreSQL, D1 atomic batches, and the planned Durable Object path for general Workers workflows.
- [ ] Add a compatibility note identifying the minimum Zebric runtime version for each Agent API capability.

#### Documentation quality gates

- [ ] Add every new page to the Starlight sidebar under an “Agents” or “Agent API” section.
- [ ] Verify all TOML, curl, JSON, routes, and response examples against `examples/issue-board` and the deterministic harness.
- [ ] Add links among the Blueprint, workflows, security, REST API, and skills reference pages instead of duplicating their foundational material.
- [ ] Run the docs build and link checks in CI.
- [ ] Mark experimental or incomplete capabilities explicitly; do not document planned scoped credentials, durable jobs, or MCP as currently available.

### Security review

- [ ] Threat-model skill route exposure, query injection, workflow parameter injection, confused-deputy behavior, replay, and credential leakage.
- [ ] Confirm CSRF bypass occurs only for valid bearer credentials.
- [ ] Confirm CORS policy is intentional for discovery and protected endpoints.
- [ ] Rate-limit authentication failures and high-cost actions.
- [ ] Sanitize workflow errors and job results.
- [ ] Verify tenant isolation for records, jobs, idempotency records, events, and audit data.

## Remaining Delivery Priority

1. Stabilize machine-readable error envelopes and strict server-side input validation.
2. Add durable single-runtime idempotency/job retention and explicitly document multi-instance limitations.
3. Complete credential expiration, rotation, revocation, and administrative issuance.
4. Enforce project/tenant/row constraints and finish the security threat model.
5. Complete OpenAPI security metadata, conformance snapshots, end-user documentation, and CI gates.
6. Add Workers parity where it can preserve the same contract; advertise unsupported capabilities until then.
7. Treat events and generated MCP as post-v1 transports over the canonical capability model.

The first usable vertical slice should include one filtered list action, one atomic claim workflow, one terminal QA transition, job observation, scoped authentication, audit attribution, and an end-to-end test. This proves the full contract before broadening it across every entity and workflow type.

## Zebric Agent Release Dependencies

These are Agent API-owned prerequisites for safely releasing a generic client. CLI behavior, model orchestration, credential-reference resolution, local approval policy, and client-side schema conversion remain owned by `ZEBRIC_AGENT_V1_TASKS.md`.

- [ ] Publish the common error envelope in OpenAPI for every applicable `400`, `401`, `403`, `404`, `409`, `422`, `429`, and `500` response.
- [ ] Give every public error a stable code and explicit retryability; distinguish idempotency-key misuse, stale state/version conflicts, workflow precondition failures, and transient server failures.
- [ ] Publish per-operation authentication requirements, required scopes, semantic risk/effect metadata, and action preconditions so a generic client can make an informed approval proposal.
- [ ] Publish a stable contract/runtime version or fingerprint input that clients can record and use to reject incompatible pending calls after refresh.
- [ ] Add conformance tests proving discovery, OpenAPI, runtime validation, authorization, errors, and job responses agree for the same action.
- [ ] Add negative conformance cases for undeclared fields, unsupported filters, invalid enums, malformed bodies, missing scopes, stale transitions, duplicate idempotency keys with changed targets/arguments, and inaccessible jobs.
- [ ] Document which failures a client may retry automatically and require idempotency protection for every retryable mutation path.
- [ ] Keep the deterministic issue-board harness as the cross-project release gate proving the published contract is sufficient without private Blueprint knowledge or hard-coded domain behavior in `@zebric/agent`.

## Definition of Done for Agent API v1

Agent API v1 is complete when:

- An agent needs only a Zebric base URL and scoped credential to connect.
- Runtime discovery exposes an accurate, sufficient machine-readable contract.
- The agent can efficiently find eligible work using server-side filters.
- Semantic mutations execute through validated Zebric workflows.
- Concurrent agents cannot claim or transition the same work incorrectly.
- Retries do not duplicate work.
- The agent can observe every asynchronous action to a terminal outcome.
- Credentials are scoped, revocable, attributable, and tenant-safe.
- Every mutation has a complete agent and workflow audit trail.
- The QA reference scenario passes through the public API in CI.
- OpenAPI is canonical, and future transports such as MCP must be generated from the same capability model rather than creating another execution path.
