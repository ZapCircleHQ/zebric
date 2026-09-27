Zebric Dispatch V1

Product Requirements Document

Target: Zebric 0.5.0
Status: Implementation specification
License: Open source
Primary artifact: Zebric blueprint and supporting application assets

⸻

1. Product Summary

Zebric Dispatch is an open-source internal operations desk for startups and small teams.

It provides a shared system for operational requests that do not naturally belong in source control, CRM, email, or chat:

* access requests
* purchasing requests
* employee onboarding
* IT/equipment requests
* engineering operations
* general internal operations

Dispatch is built as a Zebric application rather than as a conventional bespoke web application.

Humans interact with Dispatch through the Zazzle-powered web UI.

AI agents interact with the same application through Zebric’s MCP capabilities.

Both operate on the same entities, workflows, permissions, and application state.

The central product idea is:

Humans and agents share the same governed operational system of record.

Dispatch should be genuinely useful to a startup from its first day while also serving as the canonical reference implementation of an agent-native Zebric application.

⸻

2. Product Goals

G1 — Useful Internal Operations Software

A startup should be able to deploy Dispatch and immediately use it for everyday operational requests.

The product must be useful independently of its value as a Zebric demonstration.

G2 — Demonstrate Zebric 0.5.0

Dispatch should exercise Zebric’s existing capabilities wherever possible, including:

* entities
* relationships
* routes/pages
* forms
* workflows
* behaviors
* events
* authentication
* authorization
* auditability
* MCP/agent capabilities
* Zazzle UX

Dispatch SHOULD NOT recreate functionality already provided by Zebric.

G3 — Agent-Native

AI agents are first-class participants in Dispatch.

Agents should be capable of discovering and manipulating Dispatch through Zebric’s MCP interface without a separate Dispatch-specific agent API.

G4 — Human Governance

Agents must operate inside the same application rules as humans.

Agents must not bypass:

* permissions
* workflow requirements
* approvals
* application validation
* auditability

Human approval should provide an explicit boundary for operations requiring human authorization.

G5 — Showcase Zazzle

Dispatch must demonstrate that a declaratively defined Zebric application can provide a polished application experience rather than looking like a generic CRUD/admin interface.

⸻

3. Non-Goals

V1 does NOT attempt to implement:

* a ServiceNow replacement feature-for-feature
* Jira
* Slack
* a knowledge base
* a chatbot
* an AI assistant sidebar
* BPMN
* a graphical workflow designer
* advanced SLA management
* enterprise reporting
* advanced analytics
* billing
* customer support ticketing
* external customer portals
* asset management
* configuration management / CMDB
* plugin marketplace
* custom agent runtime
* agent hosting
* custom MCP server if Zebric’s MCP functionality is sufficient

Do not expand V1 to include these capabilities without an explicit requirement.

⸻

4. Target User

The initial target is a startup or small technical organization of approximately 5–50 people.

Typical users include:

* founders
* engineering leads
* developers
* operations staff
* office/people operations
* AI coding or operational agents

The organization wants enough process to keep work organized and auditable without adopting a large enterprise ITSM platform.

⸻

5. Product Model

Dispatch is centered around the concept of a Request.

A Request represents internal work requiring tracking.

Examples:

Give Alice production log access.

Purchase another Figma seat.

Provision accounts for our new engineer.

Investigate the failed nightly customer import.

Replace a developer laptop.

Review this production configuration change.

Requests progress through Zebric workflows.

Requests can involve:

* humans
* agents
* assignments
* comments
* approvals
* workflow transitions
* system events

⸻

6. Core Entities

The implementation SHOULD use the smallest data model capable of delivering the required behavior.

Do not create entities merely to reproduce framework-level functionality already provided by Zebric.

6.1 Request

The primary Dispatch entity.

Fields

id

System identifier.

requestNumber

Human-readable identifier.

Example:

DSP-1042

title

Required short description.

description

Long-form request details.

status

Allowed values:

* new
* triaged
* in_progress
* waiting
* completed
* cancelled

priority

Allowed values:

* low
* normal
* high
* urgent

Default:

normal

category

Relationship to RequestCategory.

requester

User who created the request.

assignee

User responsible for current work.

May initially be empty.

createdAt

Creation timestamp.

updatedAt

Last modification timestamp.

completedAt

Completion timestamp.

Nullable.

⸻

6.2 RequestCategory

Represents the type of operational request.

Fields

* id
* name
* description
* active

Initial seeded categories:

* General Operations
* Access & Permissions
* IT & Equipment
* Engineering Operations
* Purchasing
* People Operations

Categories SHOULD be manageable without changing application code.

⸻

6.3 Comment

Discussion attached to a Request.

Fields

* id
* request
* author
* body
* createdAt

Comments authored through MCP should use the same entity/model as comments authored through the human UI.

Do not create a separate AgentComment concept.

⸻

6.4 Approval

Represents a human authorization decision.

Fields

* id
* request
* requestedFrom
* requestedBy
* status
* reason
* createdAt
* decidedAt

Allowed statuses:

* pending
* approved
* rejected

Approval is independent from Request status.

For example, a request can remain in_progress while containing an approved approval.

⸻

6.5 Notification

Implement only if necessary beyond existing Zebric capabilities.

Required behavior:

Users need to know when:

* work is assigned to them
* an approval requires their attention

Avoid building a general-purpose notification platform.

⸻

7. Activity and Audit History

Every Request detail page must show a chronological activity history.

Activity should include meaningful events such as:

* request created
* request assigned
* status changed
* comment added
* approval requested
* approval approved
* approval rejected
* workflow action performed
* agent action performed

Prefer deriving this from Zebric’s existing event/audit facilities.

Do not build a duplicate audit infrastructure merely for Dispatch.

The human-facing activity stream may present framework audit information in a friendlier format.

Example:

Claude identified the required IAM role.

Jeff approved the access request.

System assigned the request to Priya.

Priya marked the request complete.

Agent activity should be visible rather than silently occurring in the background.

⸻

8. Workflows

Workflows are a major product feature and should be implemented using Zebric workflows.

Dispatch V1 should ship with at least three useful workflows.

8.1 General Operations

Flow:

Submitted
    ↓
  Triage
    ↓
  Assign
    ↓
In Progress
    ↓
 Complete

This is the default workflow.

⸻

8.2 Access Request

Flow:

Request Submitted
      ↓
Determine Owner
      ↓
Request Approval
      ↓
   Decision
   /      \
Approve   Reject
   |        |
Assign    Cancel
   |
Perform Work
   |
  Verify
   |
 Complete

An approval must not be bypassable through a normal status update.

⸻

8.3 Purchase Request

Flow:

Request Submitted
      ↓
Request Approval
      ↓
   Decision
   /      \
Approve   Reject
   |        |
Purchase  Cancel
   |
Record Completion
   |
 Complete

V1 does not need actual payment functionality.

⸻

9. Authorization

Use Zebric authentication and authorization.

Avoid implementing Dispatch-specific identity infrastructure unless required.

Initial logical roles:

Requester

Can:

* create requests
* view requests available to them
* comment on appropriate requests
* view status/history

Operator

Can additionally:

* triage requests
* assign requests
* perform operational work
* transition requests through allowed workflow steps
* complete requests

Approver

Can make approval decisions when authorized.

Admin

Can:

* access all Dispatch requests
* administer categories
* perform required Dispatch administration

The exact implementation should follow the authorization capabilities available in Zebric 0.5.0.

Do not create a privileged universal Agent role by default.

⸻

10. Human User Experience

Dispatch should use the improved Zazzle UX.

The application must not resemble a generic database administration interface.

V1 requires five primary application surfaces.

⸻

11. Inbox

The default authenticated landing page.

Purpose:

What needs my attention?

The Inbox should prioritize actionable work rather than metrics.

Suggested sections:

Needs Your Approval

Pending Approval records requiring the current user’s decision.

Assigned to You

Open Requests assigned to the current user.

Waiting

Requests relevant to the user currently in a waiting state.

Recently Updated

Recently changed relevant Requests.

Avoid turning the Inbox into an analytics dashboard.

⸻

12. Requests

A searchable and filterable list of Requests.

Useful views/filters:

* Open
* Mine
* Created by Me
* Waiting
* Completed
* All

Each row/card should make it easy to scan:

* request number
* title
* category
* priority
* status
* assignee
* updated time

The UI should emphasize operational scanning.

⸻

13. Request Detail

This is the signature Dispatch interface and should receive the most UX attention.

It should answer immediately:

* What is being requested?
* What state is it in?
* Who owns it?
* What needs to happen next?
* Is anything blocking it?
* What has already happened?

Header

Show:

* request number
* title
* status
* priority

Request Information

Show:

* description
* requester
* assignee
* category
* created date

Workflow Progress

Present the current workflow position clearly.

Example:

Submitted ✓ → Approved ✓ → Provisioning ● → Verify → Complete

Do not expose unnecessary workflow-engine internals in the primary UI.

Approvals

Pending approvals should be highly visible.

Authorized users should have obvious:

* Approve
* Reject

actions.

Activity

Display the chronological activity stream.

Humans, agents, workflows, and system events should appear together.

Comments

Allow users to add comments without navigating away.

Contextual Actions

Expose only actions valid for the current request/workflow state.

Examples:

* Assign
* Start Work
* Request Approval
* Approve
* Reject
* Complete
* Cancel

⸻

14. Create Request

Creating a request should be fast.

Required input:

* category
* title
* description
* priority

Default priority:

normal

The selected category should determine the appropriate workflow when possible.

Avoid presenting workflow configuration details to ordinary requesters.

⸻

15. Administration

Keep V1 administration deliberately small.

Required:

* category management
* necessary role/access administration

Prefer existing Zebric administrative capabilities where available.

Do not create duplicate Dispatch administration screens for framework functionality.

⸻

16. Agent-Native Requirements

Agent interaction is a V1 requirement.

Dispatch should rely on Zebric 0.5.0’s MCP capabilities.

A compatible MCP client should be able to understand and interact with the Dispatch domain.

Expected semantic capabilities include the equivalent of:

* list/search requests
* inspect a request
* create a request
* update appropriate request fields
* assign a request when authorized
* add a comment
* request approval
* make an approval decision when authorized
* perform valid workflow actions
* complete eligible requests

Exact MCP tool names are NOT prescribed by this PRD.

Use the normal MCP/agent capabilities generated or exposed by Zebric.

Do not implement parallel Dispatch-specific MCP tools unless a concrete gap in Zebric requires them.

⸻

17. Agent Governance

Agents are application actors, not privileged automation.

An agent must not be able to use MCP to bypass:

* validation
* authorization
* workflow rules
* approval requirements

Example:

If an Access Request requires approval before provisioning, an agent should not be able to change the Request directly to completed to circumvent the workflow.

The same domain rules must apply regardless of whether an operation originated from:

* Zazzle UI
* API
* MCP
* workflow automation

⸻

18. Agent Guidance

Prior RobotBridge experimentation demonstrated that exposing MCP tools alone does not guarantee that coding agents will use them appropriately.

Dispatch should therefore include sample agent guidance.

Suggested repository structure:

examples/
  claude/
    CLAUDE.md
  codex/
    AGENTS.md

The guidance should explain that Dispatch is the operational system of record.

Example intent:

Use Zebric Dispatch to track operational work. Check Dispatch for work assigned to you when appropriate. Record meaningful progress on the associated request. When work requires human authorization, use the Dispatch workflow to request approval rather than proceeding independently.

These files are examples/documentation rather than runtime requirements.

⸻

19. No Built-In Chatbot

Dispatch V1 should NOT contain an AI chat interface merely to demonstrate AI capabilities.

Do not add:

* Ask Dispatch AI
* Copilot sidebar
* generic chat window
* embedded LLM assistant

The agent experience should happen through external agent environments using Zebric MCP.

Dispatch is the shared system of record and human control surface.

⸻

20. Required Agent Demo

The implementation must support a demonstrable end-to-end agent scenario.

Recommended scenario:

New Employee Access

A human creates:

Give our new engineer access to production logs.

An MCP-connected agent:

1. Finds the Request.
2. Inspects its details and workflow.
3. Determines what action is required.
4. Records progress.
5. Reaches the approval requirement.
6. Requests human approval.
7. Stops before performing the protected action.

The human opens Dispatch.

The Inbox shows:

Approval required.

The human opens the Request and approves it.

The agent can subsequently:

8. Observe the approved state.
9. Continue its work.
10. Record what it did.
11. Complete the Request.

The resulting Request history should clearly show both human and agent participation.

This scenario is a V1 acceptance test.

⸻

21. Seed Data

Provide useful development/demo seed data.

Include approximately 10–15 Requests representing different states.

Examples:

* Grant production log access
* Purchase Figma licenses
* Replace developer laptop
* Investigate failed nightly import
* Provision accounts for new engineer
* Create staging environment
* Rotate shared API credential
* Add contractor to GitHub organization
* Review software purchase
* Set up conference room equipment

Include:

* multiple categories
* multiple priorities
* different assignees
* completed work
* pending work
* at least two pending approvals
* meaningful activity history

The application should feel alive immediately after starting with demo data.

⸻

22. Visual/UX Requirements

Use Zazzle’s improved design capabilities rather than accepting default CRUD presentation everywhere.

Prioritize visual polish in this order:

1. Request Detail
2. Inbox
3. Request List
4. Create Request
5. Administration

Important UX characteristics:

* strong typography hierarchy
* compact but readable operational information
* obvious state
* obvious ownership
* obvious next action
* clear workflow progress
* restrained use of color
* good empty states
* human-readable timestamps
* responsive layouts

Avoid decorative complexity.

⸻

23. Technical Principles

Blueprint First

Implement as much of Dispatch as reasonably possible in the Zebric blueprint.

The blueprint should remain understandable as a reference application.

Prefer Framework Capabilities

Before adding custom code, determine whether Zebric 0.5.0 already provides the capability.

Minimize Escape Hatches

Custom JavaScript or application-specific runtime code is acceptable when necessary, but each escape hatch should expose a meaningful framework gap.

Document those gaps.

This is important because Dispatch is also a Zebric dogfooding exercise.

No Fake Capabilities

Do not simulate framework capabilities solely to satisfy this PRD.

If Zebric 0.5.0 cannot express a requirement cleanly, document the limitation and implement the smallest reasonable workaround or leave the capability clearly identified as blocked.

⸻

24. Dogfooding Deliverable

During implementation, maintain:

ZEBRIC_GAPS.md

For every significant difficulty, record:

* desired Dispatch behavior
* relevant Zebric capability
* what worked
* what did not
* workaround used
* potential framework improvement

Pay particular attention to:

* complex business logic
* workflow ergonomics
* derived values
* contextual actions
* authorization
* MCP semantics
* agent workflow interaction
* custom request-detail UX
* activity/audit presentation
* category-dependent forms/workflows

Finding framework limitations is a successful outcome of building Dispatch.

⸻

25. Suggested Repository Structure

Adapt to the normal Zebric 0.5.0 conventions rather than forcing this exact structure.

Conceptually:

zebric-dispatch/
  README.md
  LICENSE
  AGENTS.md
  blueprint/
    dispatch.*
  examples/
    claude/
      CLAUDE.md
    codex/
      AGENTS.md
  docs/
    AGENT_DEMO.md
    DEVELOPMENT.md
  ZEBRIC_GAPS.md

Do not introduce unnecessary application scaffolding around the blueprint.

⸻

26. README Requirements

The README should explain Dispatch as both a product and reference application.

Opening message:

Zebric Dispatch is an open-source operations desk where humans and AI agents work through the same governed workflows.

Explain:

* what Dispatch does
* who it is for
* how to run it
* how it uses Zebric
* how authentication works
* how to connect MCP clients
* how to run the agent demo
* where the blueprint lives

Include a simple architecture diagram:

Human                           Agent
  │                               │
  │ Zazzle UI                     │ MCP
  ▼                               ▼
┌──────────────────────────────────────┐
│                Zebric                │
│                                      │
│ Entities     Workflows      Auth     │
│ Events       Permissions    Audit    │
│ Agent/MCP capabilities               │
└──────────────────────────────────────┘
                  │
                  ▼
            Application State

⸻

27. V1 Acceptance Criteria

Dispatch V1 is complete when a developer can demonstrate all of the following using the actual application:

Installation

* Dispatch starts successfully using the standard Zebric development workflow.
* Seed/demo data can be loaded.

Authentication

* A human user can authenticate using Zebric auth.
* Appropriate authorization rules are enforced.

Requests

* Create a Request.
* View Requests.
* Filter Requests.
* Open Request detail.
* Assign a Request.
* Comment on a Request.
* Progress a Request through its workflow.
* Complete a Request.

Approvals

* A workflow can require approval.
* An authorized user can approve or reject.
* Approval cannot be bypassed through ordinary request mutation.

UX

* Inbox identifies actionable work.
* Request detail clearly communicates state, ownership, workflow progress, approvals, and history.
* UI uses the intended Zazzle experience rather than generic CRUD wherever the PRD calls for specialized presentation.

Auditability

* Meaningful human actions appear in history.
* Meaningful agent actions appear in history.
* Workflow/system activity is distinguishable where appropriate.

MCP

Using an MCP-compatible agent:

* discover Dispatch capabilities
* find Requests
* inspect a Request
* modify permitted Request data
* add a Comment
* interact with the workflow
* request human approval

Human/Agent Handoff

Demonstrate:

Human → Agent → Approval Required → Human → Agent → Complete

without bypassing Dispatch’s workflow or authorization model.

⸻

28. Implementation Priority

Build in this order.

Phase 1 — Domain

Implement:

* Request
* RequestCategory
* Comment
* Approval
* relationships
* seed data

Verify basic Zebric-generated application behavior before customizing presentation.

Phase 2 — Workflows

Implement:

* General Operations
* Access Request
* Purchase Request

Test workflow constraints independently of agent behavior.

Phase 3 — Human UX

Build:

1. Request Detail
2. Inbox
3. Request List
4. Create Request

Use Zazzle customization where necessary.

Phase 4 — Auth and Authorization

Validate each role against actual workflows and mutations.

Phase 5 — MCP

Connect an MCP client to the application.

Verify semantic discovery and CRUD/workflow interaction.

Do not optimize for a particular agent until the basic Zebric MCP surface has been tested.

Phase 6 — Agent Scenario

Implement and document the New Employee Access scenario.

Test with at least:

* Claude Code
* Codex

Record behavioral differences where useful.

Phase 7 — Polish

Improve:

* seed data
* empty states
* activity presentation
* README
* agent instructions
* screenshots/demo

⸻

29. Core Architectural Principle

Do not build two applications:

1. a web application for humans
2. an AI application for agents

Build one Zebric application.

Humans see that application through Zazzle.

Agents see that application through MCP.

Workflows, authorization, validation, events, audit history, and state belong to Zebric and apply equally to both.

That is the central architectural requirement of Zebric Dispatch.

⸻

30. Definition of Success

The best V1 demo should require almost no explanation:

A manager opens Dispatch and sees an access request awaiting approval.

The activity history shows that an AI agent investigated the request and determined what access was needed.

The agent could not continue because the workflow required authorization.

The manager clicks Approve.

The agent subsequently continues the workflow and records completion.

The manager can see exactly what happened, who or what performed each action, and why human intervention was required.

If that experience works cleanly while the majority of the application remains expressed as an understandable Zebric blueprint, Zebric Dispatch V1 has achieved its purpose.