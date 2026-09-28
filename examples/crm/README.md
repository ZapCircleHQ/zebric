# Zebric CRM

Zebric CRM is a small-team B2B CRM where humans and agents operate the same
accounts, leads, pipeline, outreach reviews, communications, tasks, and
evidence-backed insights. The application is intentionally blueprint-first:
the system of record and its business transitions live in
[`blueprint.toml`](blueprint.toml), not in a companion application server.

The design follows the patterns proven by the Ridgeline and Dispatch examples:
row-level ownership snapshots, semantic workflows instead of generic status
mutation, scoped agent actions, application activity alongside framework audit,
and explicit approval boundaries.

## Included

- Accounts, contacts, leads, six-stage opportunities, activities, tasks,
  conversations, and messages.
- Three AE teams, supporting assistants, manager visibility, and row-scoped
  owner/assistant access.
- Google Places Text Search (New) staging into `ProspectCandidate`, keeping
  external discoveries separate from authoritative CRM records.
- Candidate promotion, lead qualification/rejection/reassignment, opportunity
  stage/win/loss commands, interaction logging, and follow-up scheduling.
- Approval-gated SendGrid outbound email. Preparing outreach creates a review
  task; only an approved message can enter the sending workflow.
- An authenticated inbound webhook boundary, inbound message/activity
  persistence, OpenAI classification, and a separate deterministic command that
  applies the reviewed classification and creates follow-up work.
- Persisted, queryable, actionable `Insight` records.
- A `crm` MCP skill with bounded reads and semantic mutation commands.
- A serious account table, pipeline board, account timeline, attention inbox,
  and contained map-like prospect view without a bespoke SPA.
- Realistic demo data: 3 AEs, 3 assistants, a manager, 20 accounts, 30 contacts,
  12 leads, 15 opportunities, activities, tasks, messages, insights, and
  external candidates.

## Run

From the repository root:

```bash
pnpm --filter zebric-crm dev
```

In another terminal:

```bash
pnpm --filter zebric-crm seed
```

Open <http://127.0.0.1:3000>. Every demo login uses `CrmDemo1!` by default.

| Role | Accounts |
|---|---|
| AE | `sarah@crm.local`, `mike@crm.local`, `jordan@crm.local` |
| Assistant | `nia@crm.local`, `leo@crm.local`, `maya@crm.local` |
| Manager | `manager@crm.local` |
| Admin | `admin@crm.local` |

Set `DEMO_PASSWORD`, `BASE_URL`, or `DB_PATH` to override seed defaults. The
seed is idempotent once `team_sarah` exists.

## External integrations

Copy `.env.example` values into your environment before starting the engine.

### Google Places

`RunGooglePlacesSearch` calls the current Places API Text Search (New) endpoint,
`POST https://places.googleapis.com/v1/places:searchText`, with a field mask and
a circular location bias. The workflow fans `places[]` into staged candidates.
The API request structure follows Google's official
[Text Search documentation](https://developers.google.com/maps/documentation/places/web-service/text-search).

Create a `ProspectSearch`, then invoke its `run_google_places_search` MCP action.
Duplicate review is deliberately explicit: the current workflow language cannot
normalize names/domains or branch on a query-result count inside a loop, so
candidates can be marked `potential_duplicate` before promotion.

### SendGrid outbound

Set `SENDGRID_API_KEY` and use a verified sender for the draft's `sender` value.
The sequence is:

```text
prepareOutreach -> pending_review + review Task
                -> approveOutreach (assistant/manager)
                -> sendApprovedEmail -> SendGrid -> Message + Activity + follow-up Task
```

The send command has a compare-and-set precondition on `approved`; preparing a
draft never sends it.

### SendGrid inbound and reply classification

The protected boundary is `POST /webhooks/sendgrid/inbound`. Zebric's webhook
receiver accepts JSON authenticated by bearer secret or Zebric HMAC. SendGrid's
Inbound Parse posts multipart form data and does not emit Zebric's signature, so
a small edge normalization adapter is required in a real deployment. It should
validate SendGrid, normalize the body to the fields shown below, and authenticate
to Zebric with `CRM_INBOUND_WEBHOOK_SECRET`:

```json
{
  "messageId": "sendgrid-external-id",
  "conversationId": "conv_...",
  "from": "prospect@example.com",
  "to": "sales@example.com",
  "subject": "Re: Introduction",
  "text": "Yes, let's talk.",
  "accountId": "acct_...",
  "contactId": "contact_...",
  "leadId": null,
  "ownerId": "user-id",
  "ownerName": "Sarah Kim",
  "assistantEmail": "nia@crm.local"
}
```

Unknown senders must be normalized with empty CRM links but retained. The
blueprint's required `conversationId`/ownership fields mean the adapter currently
creates or selects an unassigned conversation; this boundary is recorded in
`ZEBRIC_GAPS.md` rather than hidden.

`ClassifyInboundReply` asks OpenAI only for a structured taxonomy and reason.
Because the executor cannot parse JSON nested in model content, the reviewed
result is supplied to `ApplyReplyClassification`. That command records model and
reason, then deterministic workflow logic decides whether to create a task.

## Agent use

Start with a scoped development credential:

```bash
export CRM_AGENT_API_KEY='replace-with-a-long-random-secret'
pnpm --filter zebric-crm dev
```

The generated `crm` skill supports the north-star workflow: discover candidates,
review staged results, promote selected prospects, assign work, prepare outreach,
stop for human approval, inspect replies, advance pipeline, and answer “what needs
my attention?” from persisted insights and tasks. It does not expose generic
stage, disposition, approval, or insight-status mutation.

Static API keys currently cannot inherit the initiating human's team constraint.
Rows therefore carry an `agentAccessId` snapshot matching the demo sales-agent
principal, with action scopes narrowing its routes. This is broad CRM access and a
documented P0 production blocker, not a claim of equivalent delegated authorization.

## Validate

```bash
pnpm --filter zebric-crm validate
bash -n examples/crm/seed.sh
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the implementation split and
[`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md) for the experiment's actual boundary.
