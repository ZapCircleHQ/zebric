# Zebric Dispatch

Agent-native intake, approvals, audit trail, and Slack notifications — defined entirely in a single `blueprint.toml`.

Zebric Dispatch shows the minimal declarative effort needed for a genuinely useful internal workflow app. One TOML file gives you issue tracking, conditional approval routing, a full audit log, bidirectional Slack integration, and an agent-accessible API — no application code required.

## What the Blueprint Declares

### Entities

| Entity | Purpose |
|---|---|
| **TeamMember** | People (engineers, PMs, approvers) with roles and Slack handles |
| **Issue** | Requests flowing through `new → triage → in_progress → awaiting_approval → approved/rejected → done` |
| **Comment** | Threaded discussion on issues (user, agent, or system authored) |
| **AuditEvent** | Immutable log of every status change, approval, and agent action |
| **ApprovalRule** | Category-to-role mapping that drives conditional approval gates |

### Pages

| Route | Layout | What it shows |
|---|---|---|
| `/` | Dashboard | New issues and items awaiting approval |
| `/issues` | List | All issues with assignee and requester |
| `/board` | Dashboard | Kanban-style columns by status |
| `/issues/new` | Form | Create an issue with category and priority |
| `/issues/:id` | Detail | Issue detail with comments, audit log, and action bar |

### Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| **SetIssueStatus** | Manual (action bar) | Updates status + writes an audit event |
| **RequestApprovalIfNeeded** | Manual (action bar) | Checks ApprovalRule for the category; if a rule exists, moves to `awaiting_approval` and sends a Slack notification with approve/reject buttons |
| **NotifyDoneToSlack** | Issue status → `done` | Posts a "Done" notification to Slack |
| **HandleSlackApprovalActions** | Webhook (`/notifications/slack_dispatch/actions`) | Processes Slack button clicks to approve or reject, with audit logging |
| **LogAuditEvent** | Manual (reusable helper) | Appends an audit event |

### Agent Skill

The `dispatch` skill exposes a structured API for LLM agents:

- `create_issue` — POST `/api/issues`
- `get_issue` — GET `/api/issues/{id}`
- `set_status` — POST `/api/issues/{id}/status`
- `add_comment` — POST `/api/issues/{id}/comments`
- `get_audit` — GET `/api/issues/{id}/audit`

## Run

From the repo root:

```bash
pnpm --filter zebric-dispatch dev
```

Then open http://localhost:3000.

### Seed a Dev User

With the dev server running:

```bash
pnpm --filter zebric-dispatch seed:user
```

Optional overrides:

```bash
BASE_URL=http://127.0.0.1:3000 \
DEV_EMAIL=dev@zebric.local \
DEV_PASSWORD='DevPass123!' \
DEV_NAME='Dispatch Developer' \
pnpm --filter zebric-dispatch seed:user
```

### Slack Setup

Dispatch includes bidirectional Slack integration: outbound notifications with Block Kit approve/reject buttons, and inbound webhook handling for those button clicks.

Set these env vars before starting the app:

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_SIGNING_SECRET="..."
export SLACK_DEFAULT_CHANNEL="#dispatch"
```

Without `SLACK_BOT_TOKEN`, the Slack adapter is not initialized and notification workflows will fail silently.

For inbound webhooks (Slack button callbacks), configure your Slack app's Interactivity Request URL to:

```
http://yourexternalurl/notifications/slack_dispatch/actions
```

Use ngrok or a similar tool to expose your local port 3000.
