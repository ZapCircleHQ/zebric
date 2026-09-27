# Zebric Dispatch

Zebric Dispatch is an open-source operations desk where humans and AI agents work through the same governed workflows.

It gives a 5–50 person team one place for access, purchasing, onboarding, IT, engineering, and general operations requests. Humans use the Zazzle web UI. Agents use Zebric's generated agent API/MCP surface. Both act on the same `Request`, `Comment`, and `Approval` records and the same workflow guards.

```text
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
```

## What is included

- An actionable Inbox for approvals, assigned work, waiting work, and recent changes.
- A searchable/filterable operational request list.
- A polished request detail with workflow progress, approval decisions, comments, contextual actions, and a mixed human/agent activity timeline.
- General operations, access, and purchase workflows.
- Email authentication with requester, operator, approver, and admin roles.
- A scoped `dispatch` agent skill that exposes workflow actions instead of unrestricted status mutation.
- Twelve demo requests, two pending approvals, four roles, comments, and meaningful mixed activity.

The implementation is blueprint-first. The application definition lives in [`blueprint.toml`](blueprint.toml); custom Liquid is limited to the three surfaces where the PRD calls for product-specific presentation.

## Run

From the repository root:

```bash
pnpm --filter zebric-dispatch dev
```

In a second terminal:

```bash
pnpm --filter zebric-dispatch seed
```

Open <http://127.0.0.1:3000>. Every demo account uses `DispatchDemo1!` by default:

| Role | Email |
|---|---|
| Requester | `alice@dispatch.local` |
| Operator | `priya@dispatch.local` |
| Approver | `jeff@dispatch.local` |
| Admin | `admin@dispatch.local` |

Set `DEMO_PASSWORD`, `BASE_URL`, or `DB_PATH` to override seed defaults. The seed is idempotent once `cat_general` exists.

## Authentication and authorization

Zebric's email provider owns identity and sessions. The seed script provisions roles through a trusted database write because public sign-up must not be allowed to self-select an operational role. Pages require authentication, entity permissions enforce the role matrix, workflow preconditions enforce lifecycle state, and agent credentials add scopes on top.

One important current limitation is documented honestly: Zebric has no “workflow-only” field mutation policy, so a role that may run a workflow writing `Request.status` also has entity-level update permission. Dispatch only exposes guarded status actions in its UI and agent skill, but the generic entity API is not yet an airtight domain-command boundary. See [`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md).

## Connect an agent

Start the app with a credential:

```bash
export DISPATCH_AGENT_API_KEY='replace-with-a-long-random-secret'
pnpm --filter zebric-dispatch dev
```

Use the normal Zebric MCP/agent connection for the running engine and supply that bearer credential. Mutating calls also require an `X-Agent-Run-ID`; this gives the framework stable agent attribution and idempotency/audit context.

The generated `dispatch` capability includes request discovery, inspection, creation, assignment, comments, approval requests, protected-work continuation, and completion. It does not grant approval decisions to the default operator agent.

See [`docs/AGENT_DEMO.md`](docs/AGENT_DEMO.md) for the complete human → agent → human approval → agent scenario and the sample guidance in [`examples/claude/CLAUDE.md`](examples/claude/CLAUDE.md) and [`examples/codex/AGENTS.md`](examples/codex/AGENTS.md).

## Validate

```bash
pnpm --filter zebric-dispatch validate
pnpm --filter @zebric/framework-stories test -- zebric-dispatch.story.test.ts
pnpm --filter zebric-dispatch test:workflows
```

The workflow smoke test expects a running, seeded server and `DISPATCH_AGENT_API_KEY` to match the server environment.

## Dogfooding

Dispatch is intentionally both a useful example and a framework probe. [`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md) records what is native, what needed a workaround, and what should become a Zebric 0.5 capability. The gaps are part of the deliverable, not hidden implementation debt.
