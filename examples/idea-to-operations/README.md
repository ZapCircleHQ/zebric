# Idea to Operations

Northstar Labs takes ambiguous ideas through discovery, decision, planning,
delivery, launch, and ongoing operations, with humans and agents working the same
governed lifecycle. The central object is an **Initiative**, an organizational
idea becoming progressively more concrete until it is an operating capability.
Milestones, tasks, risks and dependencies exist, but they support the lifecycle
rather than define the product; this is deliberately not a project-management
tool.

This is also a Zebric stress test. Behavior the framework cannot express cleanly
is documented in [`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md) instead of being hidden in
application code. There is no companion server: the system is `blueprint.toml`,
six Liquid templates, a seed script, and a smoke test.

## The lifecycle

```
idea -> discovery -> proposal -> approved -> planning -> building -> launch -> operating -> retired
  ^                                                                              |
  +------------------- createInitiativeFromObservation <-- observation ----------+
```

Stage is changed only by named commands (Zebric workflows). Each validates the
current stage, the caller's role, and the prerequisites for the next stage, then
writes an immutable `Activity` row.

| Command | Moves | Requires |
|---|---|---|
| `StartDiscovery` | idea → discovery | owner, problem statement |
| `SubmitProposal` | discovery → proposal | owner, sponsor, expected outcome, success criteria, recommended approach; opens the approval decision request |
| `RecordDecision` | decision requested → decided | decision maker or admin; decision and rationale |
| `ApproveInitiative` | proposal → approved → planning | a decided, approved `approve_initiative` decision for this initiative; automation then creates the planning checklist |
| `CreatePlan`, `ApprovePlan` | planning | target launch date, first milestone; plan approved by a decision maker |
| `StartBuilding` | planning → building | owner, target launch date, approved plan |
| `CompleteMilestone` | milestone → completed | owner, decision maker, or admin |
| `RequestLaunchReview` | building → launch | all milestones complete; generates five readiness checks |
| `CompleteReadinessCheck` | check → ready / waived | anyone can mark ready; only a decision maker waives |
| `ApproveLaunch` | records launch approval | all checks ready or waived, no open `blocks_launch` dependency, a decided approved `approve_launch` decision, operational owner, runbook |
| `TransitionToOperations` | launch → operating | launch approved, operational owner, runbook; creates the `OperationalCapability` |
| `RecordObservation` | capability | any operator |
| `CreateInitiativeFromObservation` | observation → new idea | provenance kept on both records |
| `RetireCapability` | operating → retired | decision maker; approved `retire` decision |

Preconditions (stage, role, required fields) refuse synchronously with a 409.
Dynamic prerequisites (open milestones, unresolved checks, open dependencies, the
authorizing decision) are asserted inside the workflow and fail **after** the
request returns; see G-02 in the gap ledger.

## Run

From the repository root:

```bash
export OPS_AGENT_API_KEY=replace-with-a-long-random-secret
export ZEBRIC_RATE_LIMIT_MAX=5000     # seeding and the smoke test exceed 100 req/min
pnpm --filter zebric-idea-to-operations dev
```

In another terminal:

```bash
pnpm --filter zebric-idea-to-operations seed
```

Open <http://127.0.0.1:3000>. Every demo login uses `NorthstarDemo1!` by default.

| Person | Role | Can |
|---|---|---|
| `sam@northstar.local` | contributor | submit ideas, add evidence/questions/assumptions/alternatives, complete assigned tasks |
| `owen@northstar.local` | initiative owner | run discovery, proposals, planning, execution, launch review; request decisions |
| `dana@northstar.local` | decision maker | record decisions, approve initiatives, plans and launches, waive checks, retire |
| `olivia@northstar.local` | operational owner | manage capabilities, metrics and observations |
| `casey@northstar.local` | admin | everything |

Set `DEMO_PASSWORD`, `BASE_URL`, or `DB_PATH` to override seed defaults. The seed
is idempotent once `init_csv_export` exists. To reseed from scratch, stop the
engine and delete `data/`.

## Seed data (Northstar Labs)

Eight initiatives (six with full stories, two fresh ideas), with 11 evidence items,
4 questions and 3 assumptions, 6 alternatives, 7 decisions (3 awaiting a human),
11 milestones, 18 tasks, 4 dependencies, 6 risks, 12 readiness checks, 2
capabilities, 4 metrics, 3 observations, and an activity trail.

| Initiative | Stage | Story |
|---|---|---|
| CSV Export | discovery | Enterprise export demand; two blocking questions; three alternatives; agent research |
| Usage-Based Billing | proposal | Approval decision overdue; a second decision on the approach; hybrid recommended |
| New Customer Portal | building | Blocked billing milestone, high-impact contract risk, depends on API v2 |
| API v2 | launch | Milestones done; 3 of 5 checks incomplete; launch decision pending |
| Enterprise SSO | operating | Operational owner, runbook, healthy metrics, a stale quarterly review |
| Data Export v1 | operating | 97.4% success vs 99% target; observations that motivated CSV Export |
| Slack notifications, Audit log export | idea | Not yet in discovery (Scenario A) |

## Pages

| Page | Purpose |
|---|---|
| `/` Portfolio | initiatives grouped by lifecycle stage with health |
| `/initiatives/:id` | primary workspace: outcome, evidence, questions, assumptions, alternatives, decisions, milestones, dependencies, risks, readiness, operations, activity, and the commands valid for the current stage |
| `/attention` | what needs attention now, derived from current records |
| `/decisions` | cross-initiative decisions; decision makers record outcomes here |
| `/milestones` | milestone list with completion command |
| `/launches` | readiness checks and blocking dependencies |
| `/operations` | capabilities with metrics, observations, record and retire commands |
| `/observations` | observations, with "create initiative from observation" |

Attention and health are computed at render time over bounded queries (G-04).
The command pages exist because Zebric ties an action to the primary entity of
the page that exposes it (G-06).

## Agents

The `ops` skill exposes 24 semantic tools through the Agent API and its MCP
adapter. Discovery: `GET /.well-known/zebric-agent.json` then `GET /api/openapi.json`.
Reads cover initiatives, evidence, questions, assumptions, alternatives, decisions,
milestones, tasks, risks, dependencies, readiness, capabilities, metrics,
observations and activity, with typed filters. Writes are limited to what an agent
can *prepare*: `add_evidence`, `add_question`, `add_assumption`, `add_alternative`,
`submit_idea`, `request_decision`, `draft_milestone`, and
`create_initiative_from_observation`.

There is no approve, decide, launch, or retire tool. The agent key cannot use
generic entity CRUD (rejected with `insufficient agent scope`) or `/actions/*`,
and its write tools are workflows that set only the fields they name, so a caller
cannot smuggle `stage`, `status`, or `outcome` in the body. Mutations need
`Idempotency-Key` and `X-Agent-Run-Id` headers. Agent-authored Activity is
attributed to `Operations Agent`.

[`SCENARIOS.md`](SCENARIOS.md) lists nine repeatable prompts for Claude Code,
Codex, or another MCP client, with the tools each should discover.

## Verify

```bash
pnpm --filter zebric-idea-to-operations validate

# with the engine running and freshly seeded
BASE_URL=http://127.0.0.1:3000 OPS_AGENT_API_KEY=$OPS_AGENT_API_KEY \
  examples/idea-to-operations/scenarios/lifecycle-smoke.sh
```

The smoke test asserts the guardrails (contributor and owner cannot approve;
proposals need their fields; launch is refused while milestones, checks, or a
blocking dependency remain; agents cannot forge stage or decision outcome) and
then walks CSV Export from discovery through decision, plan, build, launch and
operations, and finally creates a new idea from an observation as the agent. It
mutates the database, so reseed afterwards. The engine log will show three
`Workflow failed: Conflict` entries, each retried three times; those are the
deliberate launch and approval refusals.

## Known limits

Read [`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md) before relying on this. In short: an owner
can still `PUT` a stage directly (G-01), scheduled operational reviews are
declared but never fire (G-03), health is event-nudged rather than derived (G-04),
and a few spec rules are unenforced (G-05).
