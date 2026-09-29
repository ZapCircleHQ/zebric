Idea to Operations — Coding Specification

1. Purpose

Build Idea to Operations, a Zebric example application demonstrating how an organization can take an ambiguous idea through discovery, decision-making, planning, execution, launch, and ongoing operations.

This is intentionally not a generic project-management application.

The goal is to model the lifecycle:

Idea
  ↓
Discovery
  ↓
Proposal
  ↓
Decision
  ↓
Planning
  ↓
Building
  ↓
Launch
  ↓
Operations
  ↓
Observation / Improvement
  └──────────────────────→ New Idea

Tasks, milestones, comments, and assignments exist, but they are supporting concepts rather than the application’s primary abstraction.

The core object is an Initiative representing an organizational idea as it becomes progressively more concrete and eventually becomes an operating capability.

This application is also a Zebric framework stress test. It should deliberately exercise capabilities that differ from the other major example applications.

⸻

2. Dogfooding Objective

Idea to Operations should expose gaps in Zebric rather than hide them.

Prefer, in order:

1. Zebric blueprint capabilities
2. Reusable/general Zebric framework improvements
3. Small application-specific extensions where unavoidable
4. Custom TypeScript/application code only as a last resort

Do not silently implement missing framework behavior with application-specific TypeScript.

If the desired behavior cannot be cleanly represented in the current Zebric blueprint/runtime, document it in:

ZEBRIC_GAPS.md

For every gap record:

* desired behavior
* current Zebric limitation
* application consequence
* workaround used
* proposed framework-level capability
* priority: P0 / P1 / P2

A successful implementation may therefore contain deliberately imperfect behavior if that exposes an important framework limitation.

⸻

3. Relationship to Other Zebric Examples

Do not turn this application into another version of an existing example.

The examples should stress different dimensions of Zebric.

Example	Primary stress area
Dispatch	Human approval workflows, authorization, audit
Ridgeline Coffee	Traditional system-of-record / line-of-business application
Merge Conflict Workflow	Deterministic orchestration + LLM reasoning and limits of declarative applications
CRM	Agent-operated business application, integrations, delegated access, insights
Idea to Operations	Long-running organizational processes, lifecycle rules, dependencies, decisions, projections, automation, and human/agent collaboration

Avoid spending disproportionate effort building sophisticated generic task-management features.

⸻

4. Product Scenario

Use a fictional software company called Northstar Labs.

Seed the application with several realistic initiatives in different lifecycle stages.

Examples:

CSV Export

Customer feedback indicates that enterprise customers need bulk CSV exports.

Current state:

Discovery

Evidence includes customer requests and support tickets.

Usage-Based Billing

The company is considering moving one product to usage-based billing.

Current state:

Proposal

Several alternatives are under consideration and an executive decision is required.

New Customer Portal

An approved initiative currently being implemented.

Current state:

Building

It has milestones, dependencies, risks, and tasks.

API v2

Implementation is complete and the initiative is approaching launch.

Current state:

Launch

Several launch-readiness checks remain incomplete.

Enterprise SSO

Previously launched and now operating in production.

Current state:

Operating

It has an operational owner, runbook, metrics, recurring reviews, and a recent operational observation that may generate another improvement initiative.

The seed data should allow the application to demonstrate the complete lifecycle immediately.

⸻

5. Primary Domain Model

5.1 Initiative

The central entity.

Suggested fields:

id
title
summary
stage
status
ownerId
sponsorId
priority
createdById
createdAt
updatedAt
targetLaunchDate
expectedOutcome
successCriteria
operationalOwnerId
launchedAt
retiredAt

Suggested lifecycle stages:

idea
discovery
proposal
approved
planning
building
launch
operating
retired

Do not treat stage as a freely editable field.

Lifecycle transitions should occur through explicit domain commands/workflows.

⸻

6. Progressive Lifecycle Requirements

A major purpose of this example is testing whether Zebric can express rules that depend on lifecycle state.

Different stages should require different information.

Idea

Minimum requirements:

title
summary
createdBy

Creating ideas should be extremely lightweight.

Discovery

Require:

owner
problem statement

Discovery may accumulate:

Evidence
Research
Assumptions
Questions
Alternatives

Proposal

Require:

expected outcome
success criteria
owner
sponsor
evidence
recommended approach

Approved

Require a recorded Decision authorizing the initiative.

Planning

Require at least:

one milestone
owner
target launch date

Building

Require an approved plan.

Launch

Require implementation milestones to be complete and launch-readiness checks to exist.

Operating

Require:

operational owner
runbook
success metrics
launch date

Retired

Require:

retirement reason
retirement decision

Determine how much of this can be expressed declaratively.

Record framework gaps where appropriate.

⸻

7. Evidence

Create an Evidence entity.

Suggested fields:

id
initiativeId
type
title
summary
sourceUrl
submittedById
createdAt

Evidence types might include:

customer_request
support_ticket
research
analytics
experiment
market_research
internal_observation
agent_research
other

Evidence should remain attached to the Initiative throughout its lifecycle.

This preserves the connection between execution and the original reason work was undertaken.

⸻

8. Assumptions and Open Questions

Create lightweight entities for:

Assumption
OpenQuestion

Example assumption:

Enterprise customers will export data at most once per day.

Example question:

Should CSV exports include archived records?

These should be resolvable rather than merely deleted.

Suggested states:

open
validated
invalidated
resolved

An agent should be able to identify unresolved assumptions/questions that block progression.

⸻

9. Alternatives

Create an Alternative entity representing approaches considered during discovery/proposal.

Fields might include:

id
initiativeId
title
description
advantages
disadvantages
estimatedEffort
status

Status:

considering
recommended
rejected
selected

The final Decision should be able to reference the selected alternative.

⸻

10. Decisions as First-Class Objects

Create a Decision entity.

Do not represent important organizational decisions solely as comments or audit events.

Suggested fields:

id
initiativeId
question
context
decision
rationale
decidedById
decidedAt
status

Optional relationships:

alternatives
evidence

Possible states:

requested
decided
superseded

Important decisions include:

* approving an initiative
* selecting an approach
* approving launch
* accepting a major scope change
* retiring an operating capability

Agents may:

* prepare decision summaries
* gather evidence
* identify unresolved questions
* recommend alternatives

Agents must not automatically perform human-authorized decisions unless explicitly permitted by policy.

⸻

11. Planning

Once approved, an Initiative can be decomposed into execution structures.

Create:

Milestone
Task
Dependency
Risk

Milestone

Fields:

id
initiativeId
title
description
ownerId
status
targetDate
completedAt

Statuses:

planned
active
blocked
completed
cancelled

Task

Keep task management intentionally simple.

Fields:

id
initiativeId
milestoneId
title
description
assignedToId
status
dueDate

Statuses:

todo
in_progress
blocked
done
cancelled

Tasks exist to support initiative execution.

Do not build Jira.

⸻

12. Dependencies

Dependencies are an important Zebric stress surface.

Support dependencies between:

Initiative → Initiative
Milestone → Milestone

A dependency should include:

source
target
type
status
description

Example:

Customer Portal launch
depends on
API v2 production availability

Explore whether Zebric can answer questions such as:

What currently blocks Customer Portal?

Which initiatives depend on API v2?

Can this initiative enter Launch?

Do not implement a sophisticated graph engine solely for this example.

Document limitations where the existing relation/query system cannot express the desired semantics.

⸻

13. Risks

Create a Risk entity.

Fields:

id
initiativeId
title
description
likelihood
impact
mitigation
ownerId
status

Status:

open
mitigated
accepted
closed

Risks should contribute to initiative health if derived/projected state is possible.

⸻

14. Initiative Health

Do not make health primarily a manually maintained field.

Desired health values:

healthy
attention
at_risk
blocked

Health should ideally be derived from facts such as:

* overdue milestones
* blocked milestones
* unresolved dependencies
* overdue decisions
* high-impact risks
* failed launch-readiness checks
* missing operational ownership

This intentionally tests Zebric’s support for:

* derived values
* projections
* aggregate queries
* rules across related entities

If current Zebric cannot cleanly express this, document the gap rather than creating a large bespoke health engine.

⸻

15. Launch Readiness

Create a ReadinessCheck entity.

Example categories:

engineering
security
support
documentation
analytics
operations
communications

Fields:

id
initiativeId
category
title
status
ownerId
notes
completedAt

Statuses:

pending
ready
waived
blocked

An initiative should not transition from:

launch → operating

unless required readiness conditions are satisfied.

This should occur through a domain command, not direct mutation of the stage.

⸻

16. Operations

The application must not end when an Initiative launches.

This is one of the defining characteristics of the example.

When an Initiative enters operating, create or associate an:

OperationalCapability

Suggested fields:

id
initiativeId
name
description
ownerId
status
runbookUrl
launchedAt
reviewCadence
lastReviewedAt

Possible statuses:

healthy
degraded
attention
retiring
retired

⸻

17. Operational Metrics

Create a lightweight Metric concept.

Example:

CSV Export Success Rate
Target: >99%
Current: 97.4%

Fields:

id
capabilityId
name
description
target
currentValue
status
updatedAt

Do not build a monitoring platform.

Seed representative values.

Metrics exist so that operating outcomes can feed future decisions.

⸻

18. Operational Observations

Create an Observation entity.

Examples:

CSV exports above 500k rows frequently time out.

Customers frequently ask for scheduled exports.

Support volume dropped after SSO self-service setup shipped.

Fields:

id
capabilityId
title
description
severity
createdById
createdAt
status

Observations may result in:

incident
improvement
new initiative

⸻

19. Closing the Loop

Provide a workflow/domain command:

createInitiativeFromObservation

This should produce a new Idea while retaining provenance back to the operational capability and observation.

The complete lifecycle should therefore be demonstrable:

Idea
 ↓
Initiative
 ↓
Delivery
 ↓
Launch
 ↓
Operational Capability
 ↓
Observation
 ↓
New Idea

This feedback loop is one of the primary reasons this example exists.

⸻

20. Domain Commands

Prefer explicit commands/workflows over unrestricted entity mutation.

Desired commands include:

startDiscovery
submitProposal
requestDecision
recordDecision
approveInitiative
createPlan
startBuilding
completeMilestone
requestLaunchReview
completeReadinessCheck
approveLaunch
transitionToOperations
recordObservation
createInitiativeFromObservation
retireCapability
retireInitiative

Where appropriate, commands should:

1. validate current state
2. validate authorization
3. validate lifecycle prerequisites
4. perform mutations
5. record provenance/audit information
6. trigger follow-up work

Determine which of these Zebric can express today.

⸻

21. Human Roles

Seed representative users.

Suggested roles:

Contributor

Can:

* submit ideas
* add evidence
* participate in discovery
* complete assigned tasks

Initiative Owner

Can:

* manage discovery
* prepare proposals
* manage plans
* coordinate execution
* request decisions
* request launch

Decision Maker

Can:

* record approval decisions
* approve major scope changes
* approve launch where appropriate

Operational Owner

Can:

* manage operational capability
* record observations
* update operational status
* initiate improvement work

Administrator

Can manage the application.

Authorization should be record-aware where possible.

⸻

22. Agent Actors

Agents are first-class participants.

The application should be fully useful through Zebric’s MCP surface without requiring the agent to operate the UI.

Agents should be able to perform tasks such as:

List initiatives needing attention.
Summarize Initiative X.
Find unresolved questions blocking Initiative X.
Gather the evidence supporting Initiative X.
Draft a proposal from its discovery material.
Break an approved initiative into draft milestones.
Find overdue milestones.
Explain why Initiative X is considered at risk.
Prepare a launch-readiness summary.
List operational capabilities with unresolved observations.
Create a draft initiative from Observation Y.

The MCP surface should favor semantic/domain-oriented tools over exposing only raw CRUD.

Test whether the agent can understand and operate the system without knowing the underlying entity schema in advance.

⸻

23. Agent Guardrails

Agents should not automatically perform high-impact actions merely because they have generic entity-write permission.

Examples requiring explicit authorization:

approveInitiative
recordDecision
approveLaunch
retireCapability

The application should help test the distinction between:

Agent can prepare work

and:

Agent has authority to make the decision

Record any inability to express this cleanly as a Zebric gap.

⸻

24. Automation

Exercise Zebric’s event/workflow model.

Potential automations:

Proposal Submitted

proposal submitted
→ create decision request
→ notify decision maker

Initiative Approved

approval recorded
→ transition to planning
→ create planning checklist

Milestone Blocked

milestone blocked
→ update/project initiative health
→ notify initiative owner

Launch Requested

launch requested
→ generate readiness checks
→ assign owners

Launch Approved

launch approved
→ create OperationalCapability
→ assign operational owner
→ record launch event

Operational Observation

important observation recorded
→ surface in operational review

Recurring Review

If supported, test time-based behavior:

operational capability due for review
→ create review work

Scheduled/time-driven workflows are explicitly worth stress-testing.

⸻

25. Activity and Provenance

Users should be able to understand:

How did we get here?

An Initiative detail page should surface meaningful activity including:

idea submitted
evidence added
proposal submitted
decision requested
decision recorded
initiative approved
milestone completed
risk opened
launch requested
readiness completed
launch approved
operational capability created
observation recorded

Prefer framework audit/event primitives where possible.

Do not create a second bespoke audit system unless necessary.

If framework audit information cannot be projected into useful application views, record that as a Zebric gap.

⸻

26. Primary UI

The UI should reinforce lifecycle rather than generic project management.

Portfolio

Show active initiatives grouped or filtered by stage.

Useful information:

stage
owner
health
target launch
blocking issue

Avoid making a Kanban board the entire product.

Initiative Detail

This is the primary workspace.

Show:

Summary
Current Stage
Health
Outcome
Evidence
Questions
Assumptions
Alternatives
Decisions
Milestones
Dependencies
Risks
Launch Readiness
Operations
Activity

Sections should become more relevant as the Initiative advances.

Decisions

A cross-initiative view showing decisions requiring attention.

Launches

Show initiatives approaching launch and their readiness.

Operations

Show operating capabilities, health, reviews, metrics, and observations.

Attention

Create an actionable view answering:

What needs attention right now?

Potential contents:

blocked initiatives
overdue milestones
pending decisions
launch blockers
high risks
stale operational reviews
important observations

This should ideally be derived from application state rather than manually curated.

⸻

27. Agent-First Scenario Tests

Create repeatable scenarios for Claude Code/Codex or another MCP client.

At minimum test:

Scenario A — Idea Triage

Ask:

Show me new ideas that haven’t entered discovery and summarize them.

Scenario B — Discovery

Ask:

What questions still need answering before CSV Export can become a proposal?

Scenario C — Proposal Preparation

Ask:

Draft the proposal for CSV Export using the existing evidence and alternatives.

Scenario D — Decision Support

Ask:

Prepare a decision brief for Usage-Based Billing. Do not make the decision.

Scenario E — Planning

Ask:

Create a draft implementation plan for the approved Customer Portal initiative.

Scenario F — Portfolio Review

Ask:

Which initiatives need attention and why?

Scenario G — Launch

Ask:

Is API v2 ready to launch? Show me anything blocking it.

Scenario H — Operations

Ask:

Which operating capabilities currently need attention?

Scenario I — Feedback Loop

Ask:

Turn the scheduled-export observation into a draft new initiative.

These should test semantic MCP discoverability rather than requiring prompts that explicitly name internal entity tables.

⸻

28. Seed Data

Seed enough interconnected data that the application is interesting immediately after startup.

Target approximately:

5–7 initiatives
10–15 pieces of evidence
5–10 assumptions/questions
5–8 decisions
10–15 milestones
15–25 tasks
several dependencies
5–10 risks
10+ readiness checks
2–3 operational capabilities
several metrics
several observations

Prefer a small coherent dataset over a large synthetic one.

Relationships should tell recognizable stories.

⸻

29. Important Zebric Stress Areas

Explicitly evaluate these framework capabilities while implementing the example.

Lifecycle-dependent validation

Can required information depend on current stage?

Domain commands

Can protected state changes occur only through workflows/commands?

Record-aware authorization

Can permissions depend on ownership, relationships, and command context?

Agent authorization

Can agent principals participate under appropriately constrained roles?

Derived state

Can health and attention be calculated from related records?

Aggregate queries

Can Zebric answer questions spanning milestones, risks, decisions, and dependencies?

Relationship traversal

Can related records participate in validation and authorization?

Dependency semantics

Can relationships prevent lifecycle transitions?

Workflow composition

Can one domain event safely trigger multiple related actions?

Scheduled automation

Can recurring operational reviews be represented declaratively?

Audit projection

Can framework audit/event information become useful application data?

MCP semantics

Can agents discover meaningful domain operations rather than merely CRUD endpoints?

Human/agent parity

Can humans and agents participate in the same workflow while retaining different authority?

⸻

30. What Not to Build

Do not turn this project into:

* Jira
* Linear
* Trello
* Basecamp
* a generic Kanban board
* a chat application
* an AI chatbot wrapper
* a full monitoring platform
* a full OKR platform
* a document editor
* a GitHub replacement

Keep generic project-management functionality intentionally modest.

The differentiating feature is the organizational lifecycle.

⸻

31. Success Criteria

The example succeeds if a reviewer can watch this sequence:

1. A lightweight idea exists.
2. Humans and/or agents add discovery evidence.
3. Open questions and assumptions become visible.
4. A proposal is prepared.
5. An authorized human records a decision.
6. The initiative progresses into planning.
7. Humans and agents execute work.
8. Dependencies and risks affect initiative state.
9. Launch readiness is evaluated.
10. An authorized launch decision occurs.
11. The initiative becomes an operational capability.
12. Operational metrics and observations accumulate.
13. An observation generates a new idea.

The reviewer should be able to understand the entire history and answer:

Why are we doing this?

Who decided this?

What is blocking it?

What happens next?

Who owns it after launch?

Did it achieve the intended outcome?

What did we learn that should become future work?

⸻

32. Framework Evaluation Deliverable

In addition to the working example, produce:

ZEBRIC_GAPS.md

At completion, categorize findings into:

P0 — prevents correct implementation of the domain
P1 — requires meaningful workaround or weakens the model
P2 — usability/developer-experience improvement

Pay particular attention to whether repeated gaps from Dispatch, Ridgeline, CRM, or Merge Conflict reappear.

Repeated gaps are more important than example-specific missing features.

Also identify capabilities that initially appeared necessary but turned out to be expressible cleanly with the existing Zebric model.

⸻

33. Guiding Principle

The application should demonstrate that Zebric is not merely a framework for declaring CRUD applications.

The intended model is:

Entities describe organizational state.
Commands describe what humans and agents are allowed to do.
Workflows describe what happens as a consequence.
Policies determine who has authority.
Events preserve what happened.
Projections explain what the organization should pay attention to.
MCP allows agents to participate in those same processes.

Idea to Operations should stress whether Zebric can declaratively encode an organization’s operating process from initial ambiguity through execution and into ongoing operations.