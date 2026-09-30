# Idea to Operations: Zebric gap ledger

## 0.6.0 migration update

- Fixed: Initiative stage is command-only and every stage workflow invokes the command pipeline.
- Fixed: the operations key has an explicit preparation-only `user` role and cannot run human approvals.
- Improved: direct HTTP/MCP commands return synchronous shared domain errors and emit framework audit/events.
- Still open: schedules, aggregates/projections, durable workflow outcomes, audit projection, and trusted delegated-human binding.

This is the implementation ledger for `examples/idea-to-operations`, written while
building it against Zebric 0.5.0. Every entry was observed running the example
(`scenarios/lifecycle-smoke.sh` exercises most of them) or read directly from
framework source; anything inferred rather than observed is labelled.

Priorities follow the coding spec:

- **P0**: prevents correct implementation of the domain
- **P1**: requires a meaningful workaround or weakens the model
- **P2**: usability / developer-experience improvement

## Summary

| ID | Pri | Gap | Repeats | Consequence here | Workaround |
|---|---|---|---|---|---|
| G-01 | P0 | Stage and lifecycle fields are not command-only | Dispatch G-01, Ridgeline G-05, CRM G-03 | An initiative owner can `PUT stage=operating` on an idea and skip every gate | Workflows are the only UI/agent path; the bypass remains for any role holding `Initiative.update` |
| G-02 | P0 | Command outcome is asynchronous; failures surface after a success response | Merge Conflicts GAP-002 (adjacent) | A refused launch approval returns 200/202, the UI flashes "started", the job fails later and retries 3x | Put every static check in `precondition` (synchronous 409); dynamic checks fail asynchronously |
| G-03 | P0 | `schedule` triggers never fire | new | Recurring operational review cannot happen on its own | `OperationalReviewDue` is declared and correct but inert |
| G-04 | P0 | No derived state, aggregates or projections | Ridgeline G-09, Dispatch G-07 | Initiative health cannot be computed; Attention cannot be served to agents | Event-nudged stored `health`; Attention derived in Liquid |
| G-05 | P1 | No count/exists/aggregate predicates in rules | Ridgeline G-08 | "All milestones complete", "at least one evidence" are unenforceable or hacked | `find` + `condition` on `.0.id` + deliberate conflict update; several rules unenforced |
| G-06 | P1 | A workflow needs the caller to hold every permission its steps use; page actions need a matching primary entity | new | Over-granted roles; five extra list pages exist only to host commands | Widen `OperationalCapability.create`, `Observation.update`; add pages |
| G-07 | P1 | Entity-event automations run as the initiating principal | new | A contributor-raised high risk cannot update initiative health | None; documented and left failing in the smoke run |
| G-08 | P1 | Skill `create` actions accept undeclared body fields; create-time rules evaluate before defaults | new | An agent could create an initiative already at `approved`, or a Decision already `decided` | Agent writes are whitelisting workflows |
| G-09 | P1 | Unresolved template references are persisted literally | new | Missing optional payload values were written as the text `{{ variables.data.payload.note }}` | Always send every payload key; `$gt ""` preconditions on required text |
| G-10 | P1 | No initiator/executor split for agent actions | CRM G-01, Dispatch G-03 | Activity shows "Operations Agent", never the human it acted for | Accept agent-as-actor |
| G-11 | P1 | Relationship traversal is shallow (belongsTo only; polymorphic edges by hand) | Dispatch G-11 | "What blocks X / who depends on X" needs two queries and Text-pair edges | Separate queries joined in Liquid; 1-hop edge table |
| G-12 | P2 | Contextual workflow inputs need a hand-written payload script | Dispatch G-05 | Every command form carries an inline `<script>` | Tiny shared submit handler |
| G-13 | P2 | Audit is not queryable by pages | Dispatch G-04, CRM G-08 | A second, application-level `Activity` trail | Each workflow writes an `Activity` |
| G-14 | P2 | Auth users are not entities | Ridgeline G-03, CRM G-09 | Roles assigned by SQL after sign-up; names denormalized into rows | `seed.sh` updates `user.role` |
| G-15 | P2 | Developer-experience rough edges | Ridgeline G-13 | New skill routes 404 until restart; default 100 req/min per IP breaks seeding; refused skill creates surface as opaque 500s | Restart; `ZEBRIC_RATE_LIMIT_MAX` |

## G-01: Stage and lifecycle fields are not command-only (P0)

- **Desired:** `Initiative.stage` changes only through `startDiscovery`,
  `approveInitiative`, `requestLaunchReview`, `transitionToOperations`, and the
  other named commands. The spec says stage must not be a freely editable field.
- **Current behavior:** a workflow's writes run under the caller's own entity
  permission (`Initiative.update`). Removing update from a role also stops that
  role running the workflow; granting it lets the same role call
  `PUT /api/initiatives/:id` with any field.
- **Verified:** as `owen` (initiative owner) on the seeded idea
  `init_slack_approvals`, `PUT {"stage":"operating"}` returned 200 and the row
  is now `operating` with no owner, evidence, decision or plan.
- **Consequence:** every guard in the commands (stage preconditions, decision
  compare-and-set, readiness and dependency assertions) protects only the
  command path. It is a soft boundary for human roles. The agent key cannot
  exploit it: generic CRUD is rejected for API-key principals with `Access
  denied: insufficient agent scope`, which is the one place scopes worked well.
- **Workaround:** row rules narrow who holds `Initiative.update` (decision
  maker, admin, the record's owner, operational owner, or an owner claiming an
  unowned idea via a `role AND stage = idea` branch). The contributor role has
  no update at all.
- **Framework direction:** command-only fields (or a workflow capability that
  writes without granting direct CRUD), enforced across UI, REST, workflow and
  MCP transports. This is the third example to hit it and the strongest
  candidate for framework work.

## G-02: Command outcome is asynchronous (P0)

- **Desired:** `approveLaunch` either succeeds or tells the caller why not, in
  the response, and never retries a refusal.
- **Current behavior:** only `precondition` is evaluated synchronously (409
  "Workflow precondition failed"). Everything after it runs on a queue: the
  HTTP response is 200/202 ("started"), a failing step (including a deliberate
  compare-and-set conflict) fails the job later, and the queue retries it three
  times.
- **Verified:** with unresolved readiness checks, `ApproveLaunch` returned 200
  and the log shows `Conflict: Initiative ... no longer matches the expected
  state` three times, then `workflow.failed`. The UI redirect carries a success
  flash.
- **Consequence:** dynamic prerequisites (checks, milestones, dependencies,
  "decision decided and approved") give the human no feedback. Static
  prerequisites (stage, role, required fields) do give an immediate refusal.
- **Workaround:** push everything that can be static into `precondition`; the
  remainder relies on the Activity trail and the job status API.
- **Framework direction:** a synchronous command result, an `assert` step with a
  user-visible message, and per-failure-class retry policy so refusals are not
  retried.

## G-03: Scheduled triggers never fire (P0)

- **Desired:** `OperationalReviewDue` runs weekly and creates review tasks for
  capabilities whose review is due.
- **Current behavior:** `trigger.schedule` is parsed and validated, and
  `WorkflowManager.triggerSchedule(cron)` exists and matches by string
  equality, but nothing in the runtime calls it (no timer, no cron loop).
  Nothing supplies "due for review" semantics either: `nextReviewDue` is data,
  not a time trigger.
- **Verified:** by source search there is no caller of `triggerSchedule`; the
  workflow has never run in any smoke or manual session.
- **Consequence:** recurring operations, a defining behavior of this example,
  is declared but inert. The Attention page shows stale reviews only because
  Liquid compares `nextReviewDue` to the clock at render time.
- **Workaround:** none in the blueprint. The workflow body is correct so it can
  be triggered externally once a scheduler exists.
- **Framework direction:** a scheduler that fires `schedule` triggers, plus
  record-relative time triggers ("when `nextReviewDue` passes").

## G-04: No derived state or projections (P0)

- **Desired:** health (`healthy`, `attention`, `at_risk`, `blocked`) is computed
  from overdue milestones, blocked milestones, open blocking dependencies, high
  risks, overdue decisions, failed readiness and missing operational ownership.
  Attention is one query an agent can ask.
- **Current behavior:** no computed fields, aggregates, or server-side
  projections. Workflows cannot count or compare across rows.
- **Verified:** health is a stored enum nudged by two event workflows
  (`MilestoneBlockedHealth`, `HighRiskHealth`). They can raise health problems
  but never clear them (no way to count what remains), and the last event wins:
  seeding the portal's high risk overwrote its `blocked` state with `at_risk`,
  so `seed.sh` re-asserts `blocked` afterwards.
- **Consequence:** health is only as correct as the events that ran. The
  Attention page is computed in Liquid over bounded queries (limit 100-200),
  visible to humans but unavailable to MCP agents, who can only read the raw
  lists (`ops_list_*`) and reason themselves. "Why is X at risk?" is answered
  by a free-text `healthReason`.
- **Workaround:** event-nudged stored health and template-side derivation, as
  the spec instructs, rather than a bespoke health engine.
- **Framework direction:** declarative derived fields over relations (count,
  exists, min/max) that are queryable from pages, workflows and skills.

## G-05: No count/exists predicates in rules (P1)

- **Desired:** lifecycle prerequisites such as "at least one milestone",
  "all implementation milestones complete", "all readiness checks ready or
  waived", "at least one evidence item", "success metrics exist".
- **Current behavior:** preconditions see only the trigger record and payload.
  A `find` step can load rows; a `condition` can test `variables.rows.0.id`.
- **Workaround used:** for "none of these may remain" rules
  (`RequestLaunchReview`, `ApproveLaunch`), `find` the offending rows, and if
  the first exists run an update against an impossible `stage` value, which
  raises a conflict and rolls the transaction back. It works but is a hack and
  inherits G-02's asynchronous failure.
- **Rules from the spec that are not enforced:**
  - proposal requires at least one Evidence (only the proposal text fields are
    checked)
  - planning requires at least one milestone before `startBuilding`
    (`createPlan` creates one, but `startBuilding` does not verify it)
  - operating requires success metrics
  - blocking assumptions/questions do not gate `submitProposal` (agents can
    list them via `ops_list_open_questions`)
- **Framework direction:** `exists`/`count` predicates usable in `precondition`
  and access rules, evaluated synchronously (with G-02).

## G-06: Workflow permission and exposure model (P1)

- **Desired:** a command such as `transitionToOperations` runs with the
  authority the *command* grants, creating the capability regardless of whether
  the caller could create capabilities directly.
- **Current behavior:** before running, the runtime requires the caller to hold
  permission for every entity action the workflow's steps use, and, for
  UI actions, `update` on the page's primary entity record. A page may only
  expose a workflow if that record entity is the page's first query.
- **Verified:** `TransitionToOperations` returned 403 "Insufficient permissions
  for this workflow" for the initiative owner until `OperationalCapability.create`
  was added to that role.
- **Consequences:** `initiative_owner` may create capabilities directly, the
  contributor/agent role holds `Observation.update` only so that
  `CreateInitiativeFromObservation` can run, and five pages
  (`/decisions`, `/milestones`, `/launches`, `/operations`, `/observations`)
  exist mainly to host commands on their primary entity.
- **Framework direction:** command-level authorization distinct from the
  underlying entity CRUD grants (same fix as G-01), and workflow exposure that
  is not tied to one page entity.

## G-07: Automations run as the initiating principal (P1)

- **Desired:** "risk opened → update initiative health" happens whoever raised
  the risk.
- **Current behavior:** an entity-event workflow inherits the initiating
  session (or system session if none).
- **Verified:** a contributor (`sam`) created a high/high risk; `HighRiskHealth`
  started as that session and failed with `Access denied: Cannot update
  Initiative`, leaving health `healthy` and writing no Activity. Automations
  triggered by an owner or decision maker succeed.
- **Consequence:** projections silently depend on who caused the event.
- **Workaround:** none applied; the failure is documented rather than masked by
  granting contributors initiative update.
- **Framework direction:** a distinct automation identity with its own scoped
  permission.

## G-08: Skill `create` actions accept undeclared fields (P1)

- **Desired:** the agent tool `submit_idea(title, summary)` can only create an
  idea.
- **Current behavior:** a skill action with `action = "create"` writes whatever
  JSON body arrives; `body = { title, summary }` documents inputs but does not
  restrict them.
- **Verified:** `POST /api/agent/initiatives {"title":..,"stage":"approved"}`
  created an initiative at stage `approved`. Attempting create-time access
  conditions (`stage = "idea"`) was worse: they evaluate before schema defaults,
  so legitimate creates that omit `stage` were rejected as well (as opaque 500s).
- **Workaround used:** agent writes are workflows that name their fields
  (`SubmitIdea`, `RequestDecision`, `DraftMilestone`,
  `CreateInitiativeFromObservation`). The smoke test sends forged
  `stage`/`status`/`outcome` values and asserts they are ignored. The remaining
  direct-create actions (`add_evidence`, `add_question`, `add_assumption`,
  `add_alternative`) can still be given a non-default `status`; none of those
  gates a lifecycle transition.
- **Framework direction:** strict body schemas for skill actions, and access
  conditions that see defaulted values.

## G-09: Unresolved template references are stored literally (P1)

- **Desired:** an omitted optional payload value is `null`/absent.
- **Current behavior:** `{{ variables.data.payload.note }}` with no `note` is
  written as that literal string, and fails outright for typed fields
  (`Invalid DateTime value for Decision.dueDate`).
- **Verified:** a decision recorded without optional fields stored
  `{{ variables.data.payload.decision }}` as its decision text; a workflow that
  passed an absent date through failed three times.
- **Workaround:** forms always send every key (empty string); required text is
  guarded by `{ "$gt" = "" }` preconditions; optional date passthroughs were
  removed from workflows.
- **Framework direction:** treat unresolved references as absent, or fail
  validation at startup for unguarded optional references.

## G-10: No initiator/executor split (P1)

- **Verified:** an agent-created idea records `actorName = "Operations Agent"`,
  `actorId = "ops-agent"` in `Activity`. No field says which human requested the
  work, so "Draft a proposal for Owen" and "the agent acted on its own" are
  indistinguishable. Same limitation as CRM G-01 and Dispatch G-03.
- **Framework direction:** delegated principals carrying both identities into
  audit, workflows and row rules.

## G-11: Relationship traversal (P1)

- **Current behavior:** `include` on a page query hydrates `belongsTo` (the
  Attention page shows `milestone.initiative.title`) but not `hasMany`: a
  capability query with `include = ["metrics","observations"]` rendered empty
  metrics. List endpoints also ignore filters such as `?initiativeId=`; skill
  action `query` parameters and page `where` do filter.
- **Dependencies:** Zebric has no polymorphic reference, so `Dependency` is a
  Text-pair edge table (`sourceType/sourceId`, `targetType/targetId`). "What
  blocks the Customer Portal" is one query on `sourceId`; "which initiatives
  depend on API v2" is a second on `targetId`. A single gating hop works
  (`ApproveLaunch` refuses while an open `blocks_launch` edge exists;
  `SatisfyDependencies` closes edges when a target starts operating). Transitive
  blocking and cycle detection are not expressible.
- **Workaround:** separate queries joined by id in Liquid.
- **Framework direction:** typed polymorphic relations, `hasMany` include, and
  recursive relation queries.

## G-12: Contextual workflow inputs (P2)

Plain HTML cannot post a structured `payload`, so every command form includes
`data-p` attributes and one shared inline script that serializes them to JSON.
Actions also require an `actionBar` entry on a page whose primary entity matches
(G-06). Same as Dispatch G-05.

## G-13: Audit projection (P2)

Framework audit is not queryable by pages, so each command writes an immutable
`Activity` row. Automations record actor `System`. This is a second trail beside
the audit log, which the spec asked to avoid unless necessary; it was necessary.

## G-14: Auth users are not entities (P2)

Roles live on Better Auth's `user` table, so `seed.sh` assigns them with
`UPDATE user SET role`, and owner/decision-maker names are copied into rows.
Same as Ridgeline G-03 and CRM G-09.

## G-15: Developer-experience rough edges (P2)

- Editing the blueprint hot-reloads, but new skill routes 404 until the engine
  restarts (same class as Ridgeline G-13).
- The default limit of 100 requests per minute per IP is easy to exceed while
  seeding or polling; `ZEBRIC_RATE_LIMIT_MAX` raises it.
- A skill `create` rejected by access rules surfaces as
  `500 INTERNAL_ERROR ... retryable: true`, not a 403.
- Skill workflow actions need `Idempotency-Key` and `X-Agent-Run-Id`; omitting
  the run id returns `400 INVALID_AGENT_ATTRIBUTION` "Valid agent run attribution
  is required" without naming the header.

## What worked natively

These initially looked like they would need extension and did not.

- **Stage-dependent requirements.** `precondition` with `{ "$gt" = "" }` on
  record fields expresses "proposal requires sponsor, outcome, criteria,
  approach" and "operating requires operational owner and runbook" cleanly, and
  refuses synchronously with a 409.
- **Decision-authorized transitions.** A compare-and-set update on the Decision
  row (`status = decided`, `outcome = approved`, matching initiative and kind)
  makes "no decided approval, no transition" a transactional assertion.
- **Record-aware and stage-aware authority.** `or`/`and` access rules express
  "owner of this record, or an owner claiming an unowned idea".
- **Role-gated authority within a workflow.** `$or` in `precondition` lets any
  owner mark a check `ready` while only decision makers may `waive`.
- **Event chains.** `Initiative` update events with `before`/`after` conditions
  compose: submit → decision request; approve → planning + checklist; reach
  operating → satisfy dependents.
- **Fan-out.** `find` + `loop` creates readiness checks, satisfies dependencies
  and generates review tasks.
- **Agent surface.** 24 semantic tools appear in `/.well-known/zebric-agent.json`
  and OpenAPI (`ops_list_open_questions`, `ops_create_initiative_from_observation`,
  ...) with typed filters. There is deliberately no approve, decide, launch or
  retire tool, and the key cannot reach generic CRUD or `/actions/*`.
- **Provenance loop.** `CreateInitiativeFromObservation` creates the idea with
  `sourceObservationId`/`sourceCapabilityId`, marks the observation
  `converted`, and records the resulting initiative id.
