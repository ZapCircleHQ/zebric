Zebric 0.6.0 — Coding Instructions

Release theme

From declarative CRUD framework to declarative operational application framework.

Zebric 0.6.0 should consolidate the lessons learned while building the 0.5.x stress-test applications:

* Dispatch
* Merge Conflict Workflow
* Ridgeline Coffee
* CRM
* Idea to Operations

Do not optimize this release for adding more demo-specific features.

Instead, identify the repeated abstractions exposed by these applications and move them into the framework.

The central architectural change is:

CRUD remains available, but it is no longer the primary abstraction for application behavior. Domain commands, workflows, policies, actors, events, and projections become first-class framework concepts.

A Zebric application should increasingly describe what operations are allowed in the domain, rather than merely which database rows may be created, read, updated, or deleted.

⸻

1. Release goals

0.6.0 should make the following substantially better:

1. Express business operations as first-class domain commands.
2. Protect state so important mutations can occur only through those commands/workflows.
3. Apply the same authorization model to humans, API clients, and agents.
4. Support record-aware and relationship-aware authorization.
5. Make framework audit/event history usable by the application itself.
6. Improve workflow expressiveness without forcing application authors into large amounts of TypeScript.
7. Make external services and agent/LLM operations fit naturally into workflows.
8. Improve blueprint modularity as applications grow.
9. Keep UI, HTTP/API, MCP, and agent interfaces derived from the same domain model.
10. Bring every existing example forward to 0.6.0 and remove workarounds where the framework now provides the missing primitive.

The release is successful if the examples become simpler, not merely if they continue to work.

⸻

2. Architectural principle: commands over CRUD

Status: Ready for Testing

Today, an application can often express:

User may update Request.

But real operational applications usually want:

Requester may submit Request.
Approver may approve Request assigned to them.
Dispatcher may assign Request.
Agent may classify Request.
System may close Request after completion.

These are not equivalent.

0.6.0 should introduce a first-class domain command abstraction.

Conceptually:

[command.ApproveRequest]
entity = "Request"
action = "approve"
[command.ApproveRequest.input]
comment = { type = "Text", required = false }
[command.ApproveRequest.policy]
expression = """
actor.role == "approver" &&
record.requestedFromId == actor.id &&
record.status == "pending"
"""
[command.ApproveRequest.mutations]
status = "approved"
approvedAt = "now"
approvedById = "actor.id"

Exact syntax is flexible. Choose syntax consistent with the existing blueprint grammar.

The important architectural requirement is that this becomes a framework primitive rather than convention implemented by application TypeScript.

Commands should be discoverable and callable through:

* generated UI
* HTTP/API
* MCP
* workflows
* agent tooling

All surfaces must invoke the same underlying command implementation.

Do not independently implement command semantics for each transport.

⸻

3. Protected and command-only mutations

Status: Ready for Testing

Several examples exposed the same security problem:

If an actor has generic update permission required by a workflow, they can potentially bypass the workflow and directly modify protected fields.

0.6.0 must solve this.

Support fields or entities whose mutations are restricted to specified commands/workflows.

Possible model:

status = {
  type = "Enum",
  values = ["draft", "submitted", "approved", "rejected"],
  write = "command-only"
}

or:

[entity.Request.protection]
fields = ["status", "approvedAt", "approvedById"]
commands = ["SubmitRequest", "ApproveRequest", "RejectRequest"]

The exact syntax is less important than enforcement.

Protection MUST apply consistently across:

* generated forms
* generic entity API
* direct HTTP mutations
* MCP entity tools
* agent API
* workflow execution
* internal framework mutation helpers

There must not be an alternate mutation surface that silently bypasses protection.

⸻

4. Unified actor/principal model

Status: Ready for Testing

0.5.x exposed a major mismatch between human and agent authorization.

0.6.0 should introduce or finish a unified actor model.

An actor may represent:

* authenticated human
* API key
* MCP agent
* service account
* workflow/system execution
* delegated agent acting for a human

At authorization time, framework code should operate on one normalized actor representation.

Conceptually:

interface Actor {
  id: string
  type: "user" | "agent" | "service" | "system"
  roles: string[]
  scopes: string[]
  delegatedBy?: string
  metadata?: Record<string, unknown>
}

Do not create separate authorization implementations for users and agents.

The same policy evaluator should answer:

Can this actor execute this command against this record?

regardless of transport.

⸻

5. Delegated agent authorization

Status: Ready for Testing

CRM exposed a particularly important agentic requirement.

An agent may be operating on behalf of a human user.

For example:

Sarah asks her sales agent:
"Show me the opportunities that need attention."

The agent should not receive global CRM visibility simply because it has an API key.

0.6.0 should establish the foundation for delegated authorization.

The framework needs to distinguish:

agent identity

from:

effective user / delegating principal

Policies must be able to evaluate the appropriate identity.

Audit records should preserve both.

Example:

actor = sales-agent
delegatedBy = sarah@example.com
command = UpdateOpportunity

Do not silently collapse the two identities.

⸻

6. Record-aware authorization

Status: Ready for Testing

RBAC alone is insufficient for the applications built during the 0.5 cycle.

Policies must be able to inspect the target record.

Examples:

request.requestedFromId == actor.id
opportunity.ownerId == actor.id
task.assigneeId == actor.id
application.createdBy == actor.id

Implement a reusable policy evaluation mechanism rather than application-specific checks.

Policies should work for:

* entity reads
* entity mutations
* commands
* workflows
* MCP exposure where applicable

Authorization should happen server-side.

UI hiding is not authorization.

⸻

7. Relationship-aware authorization

Status: Ready for Testing

CRM exposed the next step beyond record-aware authorization.

Real policies frequently traverse relationships:

actor is a member of record.team

or:

actor assists record.owner

The current workaround of copying authorization-related fields onto every record should no longer be necessary for common cases.

Support relation-aware policy evaluation.

For example, conceptually:

record.team.members contains actor.id

or an equivalent relationship query primitive.

Avoid turning the policy language into arbitrary SQL.

The goal is a constrained, inspectable, auditable authorization model.

⸻

8. Expression language

Status: Ready for Testing

Several examples required too much TypeScript because blueprints could describe structure but not enough domain logic.

0.6.0 should introduce or substantially expand a small expression language.

It should support common operations such as:

* equality / inequality
* boolean expressions
* null checks
* enum comparisons
* arithmetic where appropriate
* actor properties
* record properties
* command input
* workflow context
* relationship membership
* timestamps / now
* simple collection operations

Example:

record.status == "pending" &&
record.requestedFromId == actor.id

Do NOT attempt to create a general-purpose programming language.

Prefer:

declarative expressions for common business rules + explicit TypeScript escape hatch

over:

embedding arbitrary JavaScript strings throughout TOML.

Expressions must have deterministic evaluation semantics.

Where feasible, validate expressions at blueprint load/build time.

⸻

9. TypeScript escape hatch

Some business logic will remain too complicated for declarative expressions.

Make the escape hatch intentional.

A blueprint should be able to reference application code rather than forcing large inline scripts.

Conceptually:

[command.ScoreOpportunity]
handler = "./commands/score-opportunity.ts"

or:

handler = "commands.scoreOpportunity"

Handlers should receive framework-managed context including:

{
  actor,
  input,
  record,
  db,
  services,
  events,
  audit
}

Avoid exposing raw framework internals unnecessarily.

Application handlers should still participate in:

* authorization
* transactions
* audit
* events
* observability
* command semantics

Using TypeScript must not mean leaving Zebric’s execution model.

⸻

10. External service operations

Status: Ready for Testing

CRM and other examples demonstrated that operational applications routinely call external systems.

Examples include:

* SendGrid
* Google Places
* LLM providers
* GitHub
* Slack

0.6.0 should establish a consistent service/integration abstraction.

Blueprint/workflow logic should be able to invoke named services without embedding credentials or transport details.

Conceptually:

[services.sendgrid]
plugin = "sendgrid"
[services.places]
plugin = "google-places"

Workflow:

call places.search(...)

Application code should receive configured service clients through framework context.

Requirements:

* secrets remain outside blueprints
* calls are observable
* failures are represented explicitly
* calls can participate naturally in workflows
* external results can be transformed/validated before entering domain state

Do not attempt to ship every integration in 0.6.0.

Build the abstraction and use a small number of existing/example integrations to validate it.

⸻

11. Typed external results and transforms

Status: Ready for Testing

CRM exposed problems around:

* Google Places results
* deduplication
* counts
* LLM JSON output
* classification results

External data should not automatically become trusted domain data.

Introduce a clear path:

external response
    ↓
typed/validated result
    ↓
transform
    ↓
domain command
    ↓
domain state

Support schema validation for external/LLM responses.

An LLM returning JSON should not make that JSON authoritative merely because it parses.

Preserve explicit review steps where the application requires them.

⸻

12. Workflows as orchestration

Status: Ready for Testing

Clarify the relationship between commands and workflows.

Recommended model:

Commands represent domain intent.

Workflows orchestrate commands, services, waits, decisions, and side effects.

Example:

QualifyLead
   ↓
SearchPlaces
   ↓
CheckDuplicates
   ↓
ClassifyWithLLM
   ↓
CreateProspect
   ↓
AssignOwner
   ↓
SendIntroEmail

Individual state transitions should generally occur through commands.

Workflows should not become a backdoor around command protection.

⸻

13. Contextual workflow authorization

Status: Ready for Testing

Workflow steps need actor and record context.

Authorization must be evaluable at execution time, not merely when a workflow definition is loaded.

Support scenarios such as:

Only the requested approver may execute this decision.

and:

An agent may perform classification but may not approve the resulting record.

Long-running workflows must preserve sufficient actor/context information for subsequent audit and authorization decisions.

⸻

14. Audit history as application data

Status: Ready for Testing

Dispatch demonstrated that Zebric’s audit trail is valuable domain context.

Applications should be able to safely query it.

Introduce a permission-aware audit query primitive.

Applications should be able to answer questions such as:

Who changed this request?
Which commands ran?
Which agent touched this opportunity?
Why did this status change?
What workflow produced this mutation?

Audit entries should include, where relevant:

* actor
* delegated actor/user
* command
* workflow
* entity
* record ID
* mutation
* timestamp
* correlation/trace ID
* source surface

Audit queries must respect authorization.

Do not simply expose the raw internal audit database.

⸻

15. Domain events

Status: Ready for Testing

Commands and meaningful workflow transitions should produce domain events.

Example:

RequestSubmitted
RequestApproved
OpportunityQualified
ProspectAssigned
PullRequestConflictDetected
IdeaPromoted

Avoid requiring application authors to manually reconstruct these from generic database update events.

Events should be useful for:

* workflows
* integrations
* agents
* UI updates
* observability
* audit
* SSE/realtime interfaces

Do not create separate event systems for agents and humans.

⸻

16. MCP generated from domain capabilities

Status: Ready for Testing

0.6.0 should improve the MCP model around commands.

Instead of primarily exposing generic tools such as:

update_entity

an application should be able to expose tools such as:

approve_request
assign_opportunity
qualify_lead
promote_idea
resolve_conflict

These tools should derive from the same command definitions used by the UI and HTTP API.

Generic CRUD MCP operations may remain available where explicitly permitted.

But the preferred agent interface should increasingly reflect the application’s domain vocabulary.

This is an important architectural goal for 0.6.0.

⸻

17. Capability discovery for agents

Status: Ready for Testing

Agents should be able to understand what they are permitted to do.

Provide a machine-readable capability representation derived from:

* commands
* schemas
* permissions
* workflows where appropriate
* descriptions
* input requirements

This should improve MCP/tool usability without relying entirely on manually maintained AGENTS.md instructions.

Do not assume capability discovery eliminates the need for agent instructions; RobotBridge eval work suggests tool availability and tool use are separate concerns.

But Zebric should make its available operations as self-describing as possible.

⸻

18. Blueprint modularity

Status: Ready for Testing

The larger examples are approaching the point where a single blueprint file becomes undesirable.

0.6.0 should support modular blueprints.

Possible organization:

blueprint.toml
entities/
  request.toml
  approval.toml
  user.toml
commands/
  requests.toml
  approvals.toml
workflows/
  request-lifecycle.toml
policies/
  authorization.toml
services/
  integrations.toml

The exact file organization should remain flexible.

Important requirements:

* deterministic merge semantics
* useful duplicate-definition errors
* source locations preserved for validation errors
* ability to understand where a definition originated
* CLI/dev server should treat the collection as one application blueprint

Avoid introducing an elaborate module/package system in 0.6.0.

Simple composition is sufficient.

⸻

19. Database identifier correctness

Ridgeline exposed failures around SQL reserved words such as Order.

Generated database identifiers must be safely quoted or mapped.

An otherwise valid domain model should not fail because an entity happens to use a SQL keyword.

Add regression coverage for common reserved words.

Where an identifier truly cannot be supported, fail during blueprint validation with a useful error rather than during database initialization.

⸻

20. UI implications

Status: Ready for Testing

0.6.0 is not primarily a UI release, but command-centric applications require UI support.

Generated UI should understand commands.

For example, a record detail page might expose:

Approve
Reject
Assign
Escalate
Archive

rather than forcing all behavior through:

Edit
Save

Command UI should derive:

* label
* description
* input schema
* authorization
* availability
* confirmation requirements

from the command definition.

Commands that are unavailable for the current actor/record should not be presented as executable.

Server-side authorization remains authoritative.

⸻

21. Transaction semantics

Status: Ready for Testing

Commands modifying domain state should have explicit transaction behavior.

At minimum:

* domain mutations should be atomic where supported
* audit entries must correspond correctly to committed changes
* events should not claim committed state that subsequently rolls back
* external side effects should have documented semantics

Do not pretend distributed transactions exist.

For external operations, establish explicit ordering and failure behavior.

Example:

commit state
→ enqueue/send side effect

or:

external operation
→ validate response
→ commit state

Choose intentionally per workflow operation.

⸻

22. Observability

Status: Ready for Testing

All command/workflow/service execution should integrate with existing OpenTelemetry support.

Useful spans should identify:

zebric.command
zebric.workflow
zebric.workflow.step
zebric.service
zebric.policy

Include useful low-cardinality attributes such as command/workflow/service name.

Preserve trace/correlation IDs in audit records where practical.

A user investigating:

Why did this record change?

should eventually be able to move coherently between domain history and operational traces.

⸻

23. Error model

Status: In Progress

Create consistent framework errors for at least:

* validation failure
* authorization failure
* command unavailable in current state
* protected-field mutation
* workflow failure
* service failure
* expression evaluation failure
* external result validation failure

HTTP, MCP, UI, and internal APIs should map from the same underlying error types.

Do not create transport-specific business semantics.

⸻

24. Example migration

Every major example MUST be brought forward with 0.6.0.

For each example:

1. Upgrade its minimum Zebric version.
2. Replace relevant workarounds with new framework primitives.
3. Delete unnecessary application TypeScript where possible.
4. Preserve application behavior.
5. Update its gap ledger.
6. Mark gaps fixed by 0.6.0.
7. Document remaining gaps honestly.
8. Add/retain lifecycle smoke tests.

Do not rewrite examples merely to demonstrate new syntax.

The migration should show whether 0.6.0 actually improves them.

⸻

25. Dispatch acceptance scenarios

Dispatch should demonstrate:

* protected workflow-controlled status fields
* approval command
* record-aware approval authorization
* agent principal roles
* audit history queries
* domain events
* generated MCP commands

Critical test:

A user who may execute ApproveRequest must not thereby gain permission to directly update status = approved.

⸻

26. Merge Conflict Workflow acceptance scenarios

This example previously required excessive TypeScript.

Revisit it after the command/workflow/expression work.

Measure:

* blueprint LOC
* application TypeScript LOC
* number of framework escape hatches
* amount of workflow logic moved into Zebric

Do not force all logic into the blueprint.

The objective is to determine whether 0.6.0 moves the application materially closer to being a natural Zebric application.

⸻

27. Ridgeline Coffee acceptance scenarios

Ridgeline should validate:

* SQL-safe entity names
* command-centric order lifecycle
* richer forms where applicable
* domain rules expressed without unnecessary custom code
* application/system-of-record behavior

Use Order or another reserved-word regression case in automated tests.

⸻

28. CRM acceptance scenarios

CRM is the primary agentic acceptance application.

Validate:

* human users
* agents
* delegated agent identity
* team/relation-aware access
* command-generated MCP tools
* SendGrid/service abstraction
* Google Places/service abstraction
* typed external results
* reviewed LLM classification
* audit history
* actionable insights without granting excessive raw database access

Critical scenario:

An agent acting for Sarah should see and modify exactly what its delegated permissions allow, not every CRM record accessible to the API key.

⸻

29. Idea to Operations acceptance scenarios

Use Idea to Operations as the broad orchestration test.

Validate the lifecycle:

Idea
→ evaluation
→ approval
→ project
→ tasks
→ execution
→ completion

This example should stress:

* domain commands
* lifecycle/state transitions
* multi-entity workflows
* human + agent participation
* approvals
* domain events
* audit history
* command-driven UI
* command-driven MCP

This should become one of the best demonstrations of the 0.6 architecture.

⸻

30. Backward compatibility

Do not break basic 0.5 blueprints unnecessarily.

CRUD applications should continue to work.

Commands should be additive where possible.

However, do not preserve insecure or ambiguous behavior solely for compatibility.

If semantics must change:

1. document the change,
2. provide a useful validation/error message,
3. provide a migration path.

⸻

31. Testing strategy

Status: In Progress

Add framework-level tests for the new abstractions rather than relying solely on examples.

Required coverage should include:

* command registration
* command input validation
* command authorization
* record-aware policy
* relation-aware policy
* protected field enforcement
* human actor
* API actor
* agent actor
* delegated actor
* command audit
* command events
* workflow calling command
* MCP calling command
* HTTP calling command
* generated UI metadata
* expression parsing/evaluation
* invalid expression detection
* service invocation
* typed external result validation
* transaction rollback behavior
* modular blueprint composition
* duplicate module definitions
* SQL reserved identifiers

Where possible, run the same behavioral test through multiple transports.

Example:

ApproveRequest via HTTP
ApproveRequest via MCP
ApproveRequest via workflow

should ultimately exercise the same domain command implementation.

⸻

32. Implementation order

Recommended sequence:

Phase 1 — Execution foundation

Status: Ready for Testing

Implement:

* unified Actor
* command registry
* command execution pipeline
* protected mutations
* common error model

Get command execution working internally before adding transports.

Phase 2 — Policy system

Status: Ready for Testing

Implement:

* record-aware policies
* relation-aware policies
* expression evaluator
* delegated actor context

Centralize authorization.

Phase 3 — Runtime integration

Status: Ready for Testing

Connect commands to:

* HTTP
* MCP
* workflows
* audit
* events
* OpenTelemetry

Verify all paths converge on the same execution pipeline.

Phase 4 — Services and typed results

Status: Ready for Testing

Implement:

* service registry
* service injection
* external result schemas
* transforms/validation
* workflow integration

Use real example integrations as validation.

Phase 5 — Blueprint composition

Status: Ready for Testing

Implement modular blueprint loading and validation.

Do not do this before core semantics stabilize.

Phase 6 — UI

Status: Ready for Testing

Add command metadata and generated command actions to Zazzle/runtime UI.

Phase 7 — Example migration

Migrate all five applications.

Treat friction encountered during migration as evidence.

Do not paper over framework deficiencies inside examples.

⸻

33. Non-goals

0.6.0 does NOT need to become:

* a general-purpose workflow engine competing feature-for-feature with Temporal
* an LLM orchestration framework competing with LangChain
* an integration platform containing hundreds of connectors
* a general programming language
* a visual workflow designer
* a distributed transaction manager
* an enterprise management/control plane
* a replacement for arbitrary TypeScript

The objective is narrower:

Give operational applications a declarative domain model that humans, agents, APIs, workflows, and generated UI can all safely operate against.

⸻

34. Definition of done

0.6.0 is complete when:

* domain commands are first-class
* protected state cannot be bypassed through generic CRUD
* actors are unified across human/API/agent execution
* delegated agent context exists
* policies can evaluate records and common relationships
* common business rules can use declarative expressions
* complicated logic has a clean TypeScript escape hatch
* workflows orchestrate commands rather than bypass them
* services have a framework abstraction
* external/LLM results can be validated before mutation
* audit history is safely queryable
* commands produce meaningful events
* MCP exposes domain capabilities
* blueprints can be composed from multiple files
* SQL identifier issues are fixed
* all five stress-test examples run on 0.6.0
* the examples contain fewer framework workarounds than their 0.5.x versions
* documentation explains the new application model

⸻

35. Release-level evaluation

Before declaring 0.6.0 complete, produce:

docs/0.6.0-example-retrospective.md

For each example, record:

Example	0.5 workaround	0.6 primitive	Code removed	Remaining gap

Also record:

* blueprint LOC before/after
* custom TypeScript LOC before/after
* number of application-specific authorization checks before/after
* number of generic CRUD mutations replaced by domain commands
* remaining P0/P1 framework gaps

Do not optimize implementation merely to improve these numbers.

They are diagnostic metrics.

The central question is:

Did Zebric 0.6.0 make these applications more naturally expressible as Zebric applications?

⸻

36. Guiding architectural test

When making implementation decisions, repeatedly test them against this scenario:

A human opens an application.
An agent connects over MCP.
A workflow runs in the background.
An HTTP integration invokes an operation.
All four attempt to perform the same business operation.
Do they execute the same domain command,
through the same authorization policy,
with the same invariants,
producing the same events and audit history?

If the answer is no, the architecture is probably creating another parallel application model.

Avoid that.

Zebric should have one operational model with multiple surfaces.

That is the architectural target for 0.6.0.
