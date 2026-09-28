Zebric CRM — Coding Instructions

Objective

Build a realistic, agent-native CRM application using Zebric.

This application is intentionally a stretch test for Zebric. It should exercise the framework’s declarative application model, workflows, authorization, MCP/agent access, integrations, data-heavy UI, and LLM-assisted business processes.

The goal is not to reproduce Salesforce, HubSpot, or another commercial CRM. Build the smallest credible CRM that demonstrates an important architectural idea:

Zebric can serve as the governed system of record underneath a business process where both humans and LLM agents perform work.

Humans should be able to use the web UI, but essentially all important CRM operations should also be possible through Zebric’s MCP interface.

Do not hide Zebric limitations behind large amounts of custom application code. When the desired behavior cannot reasonably be expressed using current Zebric capabilities, document the gap.

⸻

1. Core Scenario

Model a small B2B sales organization.

The company has approximately:

* 3 Account Executives
* 1–2 Sales Assistants supporting each Account Executive
* 1 Sales Manager

The team prospects for businesses, communicates with leads, converts them into accounts, manages opportunities, and follows up with customers.

The application must support both:

1. Traditional human interaction through the Zebric UI.
2. Agent-driven operation through MCP.

A user should not need to open the CRM UI to perform normal CRM work.

⸻

2. North-Star Agent Workflow

The primary end-to-end scenario is:

“Find me ten promising veterinary clinics around Austin that we don’t already work with, research them, and prepare outreach.”

The agent should be able to:

1. Search Google Places.
2. Retrieve potential businesses.
3. Compare results against existing CRM records.
4. Avoid obvious duplicates.
5. Create prospect candidates.
6. Research or classify candidates where appropriate.
7. Recommend candidates for outreach.
8. Prepare personalized email drafts.

The user can then say:

“Looks good. Assign the north Austin prospects to Sarah and the others to Mike. Have their assistants review the outreach before it goes out.”

Zebric should:

1. Assign ownership.
2. Associate the appropriate sales assistants.
3. Create approval/review work.
4. Prevent unapproved outreach from being sent.
5. Send approved messages through SendGrid.
6. Record the outgoing messages.

When replies arrive through SendGrid:

1. Match the sender to the appropriate contact/prospect.
2. Store the inbound message.
3. Add it to CRM activity.
4. Classify the reply using an LLM when appropriate.
5. Trigger deterministic workflow behavior based on the classification.
6. Create follow-up work when necessary.

Later, the user should be able to ask:

“What needs my attention?”

The agent should return actionable CRM insights derived from current CRM state.

This scenario should guide architectural decisions throughout the implementation.

⸻

3. Core Data Model

Implement an appropriate relational model containing at least the following concepts.

User

Represents CRM users.

Important concepts:

* name
* email
* role
* active/inactive

Do not duplicate framework identity unnecessarily if Zebric already provides an appropriate identity primitive.

Sales Team / Account Team

Represents working relationships between Account Executives and Sales Assistants.

A team should support:

* one Account Executive
* one or more Sales Assistants
* team-visible records

The exact entity structure can follow existing Zebric relationship capabilities.

Account

Represents a company/customer.

Suggested fields:

* name
* website
* phone
* address
* latitude
* longitude
* industry/category
* status
* owner/team
* source
* createdAt
* updatedAt

Contact

Represents an individual associated with an Account.

Suggested fields:

* firstName
* lastName
* email
* phone
* title
* account
* status
* owner
* createdAt
* updatedAt

Lead

Represents a qualified or manually entered sales lead that has not necessarily become a customer.

Suggested concepts:

* company/person
* source
* owner
* status
* qualification state
* next action
* last activity
* account/contact conversion relationships

Opportunity

Represents a potential sale.

Suggested fields:

* name
* account
* owner
* stage
* amount
* probability if appropriate
* expectedCloseDate
* nextAction
* status
* createdAt
* updatedAt

Use a sensible small stage model rather than recreating a giant enterprise CRM pipeline.

Example:

* discovery
* qualified
* proposal
* negotiation
* won
* lost

Activity

Represents important CRM activity.

Examples:

* email sent
* email received
* call logged
* meeting
* note
* status change
* assignment
* workflow event

Activities should form a useful timeline for an Account, Contact, Lead, or Opportunity.

Conversation

Groups communication when useful.

Message

Represents inbound and outbound communications.

Important concepts:

* conversation
* contact
* account
* direction
* sender
* recipients
* subject
* body
* SendGrid identifier
* status
* received/sent timestamp

Task

Represents human work.

Examples:

* review outreach
* follow up
* call prospect
* investigate reply
* update opportunity

Tasks must support assignment.

ProspectSearch

Represents an explicit prospecting operation.

Store enough information to understand what was searched for and when.

ProspectCandidate

Represents an external business discovered during prospecting but not yet promoted into authoritative CRM data.

Suggested concepts:

* search
* external source
* external identifier
* name
* address
* location
* category
* rating
* review count
* website
* phone
* evaluation
* disposition
* potential duplicate
* promoted lead/account

Do not automatically make every Google Places result an Account or Lead.

Insight

Insights must be application data, not transient dashboard prose.

Suggested structure:

* type
* account
* contact
* lead
* opportunity
* owner
* severity/importance
* summary
* evidence
* suggestedAction
* generatedAt
* expiresAt
* status

Suggested statuses:

* open
* acknowledged
* acted_on
* dismissed
* expired

Insights should be queryable through MCP.

⸻

4. Ownership and Authorization

This is a major part of the experiment.

Implement realistic team-scoped CRM authorization.

An Account Executive should primarily access records they own or that belong to their team.

A Sales Assistant should be able to work with records belonging to Account Executives they support.

A Sales Manager should have broader visibility.

Test at least:

* Account ownership
* Opportunity ownership
* Lead ownership
* Tasks assigned to assistants
* Team visibility
* Reassignment
* Manager visibility

Authorization must apply consistently across:

* UI
* API
* MCP
* workflows

Do not implement authorization only as UI filtering.

If current Zebric authorization cannot express these rules cleanly, document the gap.

⸻

5. Domain Commands

Avoid exposing unrestricted CRUD as the primary agent interface for important business state changes.

Prefer semantic operations such as:

* qualifyLead
* rejectLead
* promoteProspect
* assignAccount
* reassignLead
* createOpportunity
* advanceOpportunity
* markOpportunityWon
* markOpportunityLost
* logInteraction
* scheduleFollowup
* prepareOutreach
* approveOutreach
* sendApprovedEmail
* dismissInsight
* actOnInsight

These should invoke business rules and workflows.

For example, an agent should not normally change:

opportunity.stage = "won"

directly.

It should invoke:

markOpportunityWon(...)

The implementation should test whether Zebric can enforce workflow-only or command-only mutations.

If it cannot, record this explicitly as a Zebric gap.

⸻

6. SendGrid Integration

Implement outbound and inbound email using SendGrid.

Outbound

Support:

1. Email draft creation.
2. Human/agent preparation.
3. Optional approval.
4. Sending through SendGrid.
5. Delivery state recording.
6. CRM Activity creation.

Do not make arbitrary email sending an unrestricted MCP operation.

Inbound

Use SendGrid’s inbound/webhook capabilities where appropriate.

An inbound message should:

1. Enter Zebric through a defined integration/event boundary.
2. Be persisted.
3. Be matched to a Contact/Lead/Account where possible.
4. Create CRM activity.
5. Trigger appropriate workflows.

Unknown senders should be retained rather than silently discarded.

Keep external identifiers needed for idempotency and troubleshooting.

⸻

7. Reply Classification Workflow

Create an LLM-assisted inbound email workflow.

Classify relevant prospect replies into a small structured taxonomy such as:

* interested
* not_interested
* follow_up_later
* referral
* question
* unclear

The LLM determines classification.

Zebric determines consequences.

inbound email
    ↓
persist message
    ↓
identify CRM record
    ↓
LLM classification
    ↓
deterministic workflow
    ↓
update state / cancel tasks / create task / notify owner

An LLM should not independently perform arbitrary CRM mutations after reading an email.

Retain enough information to audit why the resulting action occurred.

⸻

8. Google Places Prospecting

Integrate with the current Google Places API.

Support geographically constrained prospect searches.

Example:

Independent veterinary clinics within 20 miles of Round Rock.

Store search results as ProspectCandidate records.

The system should support:

* map location
* business name
* Google/Places identifier
* address
* website where available
* phone where available
* category
* rating/review information where available
* duplicate detection against CRM records

Keep external prospect data separate from authoritative CRM entities until promotion.

⸻

9. Prospect Promotion Workflow

Implement a workflow for moving:

ProspectCandidate → Lead

and eventually:

Lead → Account + Contact + Opportunity

Promotion should preserve provenance where practical.

Do not duplicate existing records when the candidate appears to correspond to an existing Account.

If reliable automated matching is impossible, support a potential_duplicate state requiring human review.

⸻

10. Map Interface

Provide a useful Google Maps-based prospecting interface.

The map should display ProspectCandidate records and, where useful, existing Accounts.

A user should be able to:

* perform/view a prospect search
* see candidate locations
* select a candidate
* inspect CRM-relevant information
* identify existing customers where practical
* promote or reject candidates

Keep custom frontend code contained.

If a substantial custom application must be built outside Zebric’s declarative UI system, record why.

⸻

11. Customer Data Table

Build a serious operational data table for Accounts/Customers.

Attempt to support:

* filtering
* sorting
* configurable/useful columns
* pagination
* saved views if available
* multi-selection
* bulk assignment
* bulk tagging if appropriate
* bulk workflow/command invocation
* CSV import/export where supported
* inline editing where safe and supported

Useful views include:

* My Accounts
* Team Accounts
* Needs Follow-up
* Recently Contacted
* Stale Accounts
* Active Opportunities

Do not build an entire bespoke grid component merely to satisfy this requirement.

Instead, determine what Zebric supports and record missing capabilities.

⸻

12. Actionable Insights

Implement CRM Insights as persisted records.

Initial insight rules can include:

Stale Account

No meaningful activity within a configured period.

Opportunity Without Next Action

An active opportunity has no scheduled next step.

Closing Soon

An opportunity’s expected close date is approaching without sufficient recent activity.

Unanswered Prospect

Outbound prospect communication has not received a reply within a configured period.

Interested Prospect

An inbound message was classified as interested but no follow-up task exists.

Team Workload

An Account Executive or assistant has an unusual number of unresolved follow-ups.

Where possible, generate insights deterministically.

Use an LLM where interpretation genuinely improves the result.

Every Insight should contain evidence explaining why it exists.

Insights should lead to actions.

Insight
  "Acme has not been contacted for 14 days."
            ↓
      scheduleFollowup
            ↓
          Task

⸻

13. Agent / MCP Experience

The CRM must be usable primarily through MCP.

Test realistic prompts such as:

Show me my opportunities closing this month.

What needs my attention today?

Summarize everything that has happened with Acme.

Find veterinary clinics near Round Rock that aren’t already customers.

Prepare outreach for the five best prospects.

Assign these prospects to Sarah.

What replies came in today?

Which prospects appear interested?

Move the Acme opportunity forward after today’s meeting.

Give Sarah’s assistant everything that needs review.

MCP access must respect the same authorization and business rules as UI access.

Do not create a privileged MCP backdoor around the application.

⸻

14. Agent Identity

Explicitly test agent principals.

Record:

* which human initiated work
* which agent performed work
* what command/tool was invoked
* what records changed
* what workflow caused the change

Where delegation is relevant, preserve the distinction between:

Sarah requested the action

and:

Agent X executed the action

Do not collapse all MCP operations into a generic system user if avoidable.

Document framework limitations encountered here.

⸻

15. Approval Workflow

Implement at least one meaningful human-in-the-loop workflow.

Use outbound prospecting email as the primary example.

Agent prepares email
        ↓
Review task assigned to Sales Assistant
        ↓
Assistant edits/approves
        ↓
SendGrid sends message
        ↓
Message + Activity recorded
        ↓
Follow-up scheduled

The system must prevent sending before approval when approval is required.

Test authorization around who may approve.

⸻

16. Provenance

Preserve provenance where practical.

Important questions include:

* Was this record manually entered?
* Did it originate from Google Places?
* Was it imported?
* Was it generated by an agent?
* Was a value inferred?
* Which user/agent initiated the change?

Do not invent an elaborate generic provenance framework solely for this application.

If Zebric lacks an appropriate primitive, document what a reusable framework capability might look like.

⸻

17. Auditability

Important state transitions must be auditable.

Especially:

* ownership changes
* opportunity stage changes
* prospect promotion
* agent mutations
* email approval
* outbound email sending
* inbound email classification
* Insight actions
* bulk operations

Where possible, distinguish application Activity from framework Audit records.

Do not duplicate framework audit information merely to make it visible in the application unless necessary.

Record any gap around querying or projecting framework audit data.

⸻

18. Seed Data

Provide realistic development/demo data.

Include:

* 3 Account Executives
* assistants assigned to those AEs
* 1 manager
* approximately 20 Accounts
* approximately 30 Contacts
* Leads in multiple states
* Opportunities across several stages
* Activities
* Tasks
* inbound/outbound Messages
* several Insights
* several ProspectCandidates

Include scenarios that exercise authorization boundaries.

Avoid using real people’s personal information.

⸻

19. Demo Scenarios

The completed application should support at least these demonstrations.

Demo A — Traditional CRM

Open the application, browse Accounts, inspect a customer, view contacts, opportunities, activities, and tasks.

Demo B — Team Access

Log in as an AE and assistant and demonstrate that each sees the appropriate CRM records.

Demo C — Prospecting

Search Google Places and display candidates on the map without polluting authoritative Account data.

Demo D — Agent Prospecting

Use MCP to find and evaluate prospects.

Demo E — Human Approval

Have an agent prepare outreach and an assistant approve it.

Demo F — Email Loop

Send email, receive a simulated or real reply, classify it, and trigger follow-up behavior.

Demo G — Insights

Ask:

“What needs my attention?”

Return actionable, evidence-backed Insight records.

Demo H — Agent-First CRM

Perform a meaningful CRM workflow through MCP without opening the web application.

⸻

20. Architecture Principle

Prefer this model:

External Systems
     ↓
Zebric integrations/events
     ↓
Entities + domain commands
     ↓
   Workflows
   ↙      ↘
LLM step   deterministic step
   ↘      ↙
governed application state
     ↓
 UI / API / MCP

The LLM is not the application.

The agent is not the system of record.

Zebric owns:

* state
* authorization
* workflows
* commands
* auditability
* business invariants

Agents reason about and operate upon that system through governed interfaces.

⸻

21. Avoid Application-Specific Framework Hacks

Do not add concepts such as:

if (appName === "zebric-crm") {
    // ...
}

to the Zebric runtime.

Framework changes must be generalized.

Before adding a runtime feature, ask:

Would Dispatch, Ridgeline, or another Zebric application plausibly use this capability?

If yes, implement it generically where appropriate.

If no, prefer application code or record the limitation.

⸻

22. Gap Analysis

Maintain:

ZEBRIC_GAPS.md

throughout development.

Do not wait until the implementation is complete.

For each meaningful limitation record:

* priority
* desired behavior
* current Zebric behavior
* consequence for CRM
* workaround used, if any
* proposed general framework capability

Use priorities:

* P0 — prevents correct implementation or violates important security/business invariants
* P1 — major missing capability requiring substantial workaround
* P2 — meaningful usability/developer-experience limitation
* P3 — polish or convenience

Also record actual runtime bugs separately from missing capabilities.

A workaround succeeding does not mean the gap should be omitted.

⸻

23. Blueprint vs Code

At completion, analyze where the implementation lives.

Report approximately:

* declarative blueprint
* workflows
* integration adapters
* application TypeScript/JavaScript
* custom UI code
* framework modifications

The CRM experiment should help answer:

How much of a sophisticated agentic business application can actually be expressed as a Zebric blueprint?

If most business behavior migrates into application-specific TypeScript, call that out explicitly.

Do not optimize the implementation to make the blueprint artificially impressive.

⸻

24. Implementation Strategy

Build vertically rather than implementing every entity first.

Phase 1 — CRM Foundation

Accounts, Contacts, Leads, Opportunities, ownership, basic UI and seed data.

Phase 2 — Team Authorization

AE/assistant/manager access and record-aware permissions.

Phase 3 — Domain Commands

Implement governed business mutations and test them through UI/API/MCP.

Phase 4 — Prospecting

Google Places integration, ProspectSearch, ProspectCandidate, deduplication and promotion.

Phase 5 — Communications

Messages, Conversations, SendGrid outbound/inbound and Activity integration.

Phase 6 — Workflow Automation

Approval workflow, inbound classification, follow-ups and opportunity behaviors.

Phase 7 — Insights

Persisted actionable Insight generation and actions.

Phase 8 — Agent-First Operation

Exercise complete workflows through MCP.

Phase 9 — UX Stretch

Map, operational data table, saved/bulk operations.

Phase 10 — Evaluation

Finish gap analysis and summarize what the experiment says about Zebric 0.5.

Do not spend substantial time polishing later phases while P0 correctness/security gaps remain unresolved.

⸻

25. Definition of Done

The project is complete when:

1. The CRM works as a credible small-team CRM.
2. Accounts, Contacts, Leads and Opportunities are usable through the web UI.
3. Team ownership and authorization are enforced.
4. Prospecting uses Google Places.
5. Prospect candidates can be viewed geographically.
6. SendGrid supports outbound and inbound email.
7. At least one inbound email workflow uses an LLM classification step.
8. At least one important workflow requires human approval.
9. Actionable Insights are persisted and actionable.
10. Important business operations are available through MCP.
11. MCP operations respect authorization.
12. Agent actions are auditable.
13. Domain commands protect important business transitions.
14. Seed/demo data exercises realistic scenarios.
15. ZEBRIC_GAPS.md accurately records framework limitations discovered during implementation.
16. The final project contains an architectural retrospective describing what belonged naturally in Zebric and what did not.

The success criterion is not that Zebric handles everything.

Discovering that an important requirement does not fit Zebric cleanly is a successful result if the limitation is understood, reproduced, and documented.

The CRM should push Zebric until we can clearly see the boundary between:

declarative agentic business application framework

and

custom application code.