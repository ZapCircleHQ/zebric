# Zebric gaps found while building Merge Conflict Workflow

## 0.6.0 migration update

- Fixed for the human boundary: approval and rejection now use protected domain commands with framework audit/events.
- Still open: the 732-line TypeScript orchestrator remains necessary because typed local handlers, durable waits, model steps, artifacts, and governed Git credentials are not yet framework primitives.

## Gap summary

| Priority | Gap | Workflow consequence | Possible direction |
|---|---|---|---|
| P1 | Typed example-defined action steps | Repository/classifier/agent work runs beside, not inside, the declarative workflow | Typed local action/plugin contract |
| P1 | Durable pause/resume and approval | Approval is represented as records and separate calls rather than one durable execution | Durable workflow instances and wait states |
| P1 | Structured model steps and provenance | The example must own model schemas, validation, and provenance | Typed model step with recorded inputs/outputs |
| P2 | Step output expressions and branching ergonomics | Nontrivial policy is substantially easier in TypeScript than blueprint expressions | Typed expressions over prior results |
| P2 | First-class attempt artifacts | Large base/ours/theirs/proposals do not belong comfortably in ordinary entity fields | Artifact references with retention/redaction |
| P2 | Queryable workflow audit detail | Framework lifecycle audit does not capture all domain evidence | Structured step-level audit query API |
| P2 | External credential binding | GitHub credentials must be injected and governed by the host | Named secret references scoped to actions |

## GAP-001: Typed example-defined action steps

### Desired behavior

A Zebric workflow should invoke an example-local action such as `inspect_conflicts`, `classify_conflict`, or `validate_candidate`, validate its typed result, and make that result available to later policy steps.

### Current Zebric behavior

The Node executor supports built-in query, webhook, notification, condition, loop, delay, and registry plugin steps. A plugin action is possible only through runtime registry wiring; the example runtime CLI has no straightforward blueprint-local TypeScript action registration path.

### Consequence

The executable orchestrator is example-local TypeScript. The Zebric blueprint provides durable data and human decisions, but cannot authoritatively run the Git workflow without a custom host.

### Example

Reading Git index stages returns an array of typed `ConflictFile` values that policy must loop over.

### Workaround used

`MergeConflictWorkflow` implements orchestration locally and keeps all domain code inside this example.

### Possible framework direction

Provide a typed action registration interface for application-local code, with input/output schema validation, authorization, timeouts, and audit hooks.

## GAP-002: Durable workflow pause, resume, and approval

### Desired behavior

A running resolution should durably wait for an authorized reviewer, then resume at publication (or route back for revision) without replaying external mutations.

### Current Zebric behavior

Manual workflows and preconditions can govern record transitions, but an execution does not expose a durable wait/resume token or human-task primitive.

### Consequence

The example returns an `awaiting_approval` record and requires a separate `approve` or `reject` call. The blueprint separately records review decisions.

### Example

A high-risk production configuration candidate passes tests but must not be committed until a reviewer approves it.

### Workaround used

Explicit state plus separately audited approval/rejection methods and blueprint workflows.

### Possible framework direction

Durable workflow instances with wait states, assigned human tasks, authorization policy, expiry, and resume/compensation semantics.

## GAP-003: Structured model steps and provenance

### Desired behavior

Invoke a classifier or agent with a declared input/output schema, bounded context, model identity/version, retry policy, and automatically retained provenance.

### Current Zebric behavior

There is no first-class model step in the workflow executor. Webhooks can call an external service but do not provide model semantics or structured-output enforcement.

### Consequence

The example defines `ConflictClassifier` and `ResolutionAgent`, validates their shapes at compile time only, and emits provenance itself.

### Example

Jev should return a classification and risk, while an LLM should return resolved content, explanation, assumptions, and a review flag.

### Workaround used

Narrow TypeScript interfaces and audit events. Jev is represented by an injected inference callback because no supported repository dependency is available.

### Possible framework direction

A model step with runtime schemas, provider abstraction, context limits, provenance, redaction, and deterministic fixture substitution.

## GAP-004: Workflow expressions over prior typed outputs

### Desired behavior

Branch over fields of a previous step result, loop over conflict files, collect per-file results, and express bounded retries with failed evidence.

### Current Zebric behavior

Steps can assign results and conditions/loops can read context paths, but blueprint schemas are permissive and complex collected-output/retry policy is not strongly typed or ergonomic.

### Consequence

The policy graph would be fragile and difficult to inspect if encoded as nested untyped step objects.

### Example

`IMPORTS + LOW` routes to a deterministic resolver; failed validation routes to the next agent attempt; exhausted attempts route to review.

### Workaround used

Explicit TypeScript control flow in `MergeConflictWorkflow`.

### Possible framework direction

Typed expressions, named step outputs, collection operators, and bounded retry blocks whose state appears in the workflow graph.

## GAP-005: First-class attempt artifacts

### Desired behavior

Persist large base/ours/theirs content, patches, validation logs, and model context as immutable artifacts with access control and retention.

### Current Zebric behavior

Entity text/JSON fields and external storage are available building blocks, but workflows do not have a first-class artifact reference lifecycle.

### Consequence

Persisting all evidence directly would bloat application tables and make sensitive-source retention accidental.

### Example

A compiler log or source file can be megabytes, while a resolution record should retain a stable evidence reference.

### Workaround used

Tests use an in-memory audit sink; the blueprint stores only fields suitable for a small demo.

### Possible framework direction

Immutable artifact handles with size limits, hashes, MIME types, redaction, retention, and authorization.

## GAP-006: Queryable step-level workflow audit

### Desired behavior

Query one resolution and reconstruct trigger, classifier provenance, selected route, model context, attempts, validation, reviewer, and resulting commit.

### Current Zebric behavior

Workflow lifecycle audit exists, but arbitrary typed step evidence and domain correlation are not exposed as one queryable execution history.

### Consequence

The example emits its own small evidence stream in addition to modeling records in the blueprint.

### Example

An operator needs to explain why a conflict was automatically committed rather than reviewed.

### Workaround used

`AuditSink` receives structured domain events. This is intentionally small, not a parallel general audit framework.

### Possible framework direction

Correlated workflow execution/step records with typed inputs, outputs, decisions, actor attribution, and artifact links.

## GAP-007: Governed external credential binding

### Desired behavior

Bind a named GitHub credential to only the fetch/push/API actions for an approved repository without exposing the token to model context or persisted workflow values.

### Current Zebric behavior

Environment-backed webhook/API credentials exist in specific surfaces, but there is no general secret binding for example-defined actions.

### Consequence

The GitHub adapter requires its client and push function from the trusted host. The example cannot declare their least-privilege credential policy in its blueprint.

### Example

Publishing a resolution branch needs GitHub write access; classification does not.

### Workaround used

Credential handling is entirely delegated to the host and publishing fails closed when no push function is configured.

### Possible framework direction

Named secret references with action-level scopes, non-serializable handles, rotation, and audit metadata that never includes secret values.
