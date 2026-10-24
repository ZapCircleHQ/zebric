# Zebric CRM gap ledger

## 0.6.0 migration update

- Fixed: lead/opportunity transitions, reviewed outbound-message state, reviewed reply classification, and insight disposition use domain commands.
- Fixed: the CRM API key declares the `sales_agent` role; policies use the unified actor and preserve trusted delegated identity.
- Still open: no safe example-level binding proves which human delegated an API-key request, so Sarah's delegated-agent scenario needs host integration. Google Places/SendGrid also remain webhook workflows rather than typed service adapters.

This is the implementation ledger for `examples/crm`, not a wishlist written in
advance. Priorities reflect correctness and production impact. Workarounds are
kept visible even when the demo succeeds.

## Summary

| Priority | Gap | CRM consequence | Workaround |
|---|---|---|---|
| P0 | Delegated agent row authorization | Static agent keys cannot inherit Sarah's or Mike's team visibility | Explicit team membership plus narrow scopes; trusted delegation still needed |
| P1 | Relation-aware team access | Resolved: stored active membership authorizes rows | Immutable team/parent references |
| P1 | Workflow-only protected fields | Resolved: protected fields and immutable review drafts | Workflow-scoped domain commands |
| P1 | Typed external-response transforms | Places dedupe/count and LLM JSON parsing are not robustly expressible | Stage results; explicit duplicate review; reviewed classification command |
| P1 | SendGrid Inbound Parse mismatch | Native webhook expects JSON plus Zebric auth, not SendGrid multipart | Narrow deployment-edge normalization adapter required |
| P2 | Data-grid composition | No saved views, CSV, safe bulk commands, or inline-edit policy | Local filter/selection enhancement; no fake bulk mutation |
| P2 | Browser integration configuration | No secret-safe Maps widget/key binding | Coordinate fallback view; production map left as explicit gap |
| P2 | Queryable framework audit | UI cannot project audit records into account timelines | Append immutable application `Activity` for business events |
| P2 | User application profile | Better Auth User cannot hold `active` or team fields and is not queryable | TeamMembership entity; seed roles through trusted DB write |
| P3 | Human-readable references | No transactional sequence primitive | Use stable ULIDs/seed ids |

## G-01 — Trusted delegation remains a host responsibility (P0)

Static API keys cannot prove which human delegated a request. Demo agent access
now requires explicit active `TeamMembership` rows, provisioned by the seed.
The broad `agentAccessId` snapshot workaround has been removed. Production hosts
must bind delegated identity securely or provision the agent's teams explicitly.

## G-02 — Relation-aware authorization (resolved)

Policies traverse stored `team.memberships`, filtered to active rows. Parent
links and `teamId` are immutable, and create policies require matching parent
teams. Deactivating a membership revokes access without rewriting CRM records.
Owner/email snapshots are no longer authorization inputs.

## G-03 — Workflow-only lifecycle fields (resolved)

Lifecycle commands are scoped to their semantic workflows. Outreach content,
recipients, author, and designated reviewer cannot be edited after creation;
approval attribution is command-only and uses the actual actor. Independent
review is enforced even when the caller reaches generic entity/command APIs.

## G-04 — External data transformation (P1)

- **Desired:** normalize domains/phones/names, query CRM duplicates per Places
  result, branch on match confidence, count results, and parse the model's JSON
  response under a schema.
- **Current behavior:** webhook and loop steps can carry nested values, but workflows
  lack typed expressions, JSON-schema response parsing, array length, string
  normalization, and a reliable branch on query-result cardinality.
- **Workaround:** Places rows are staged with external IDs and reviewed for
  `potential_duplicate`. LLM inference and deterministic state mutation are split;
  `ApplyReplyClassification` receives reviewed structured fields and persists the
  evidence/model.
- **Framework direction:** typed transforms, validated HTTP response schemas,
  expression functions, and query cardinality predicates.

## G-05 — SendGrid inbound boundary (P1)

- **Desired:** accept SendGrid Inbound Parse directly, validate its authenticity,
  retain the raw external id, match a sender, and preserve unknown senders.
- **Current behavior:** Zebric webhook workflows parse JSON and authenticate using
  a bearer secret or Zebric HMAC. SendGrid posts multipart form fields with its own
  verification model. Workflows also cannot create/select an unassigned
  conversation by matching sender email.
- **Workaround:** documented edge adapter validates SendGrid, normalizes JSON,
  resolves or creates the unassigned conversation/ownership envelope, then signs
  the Zebric call. It contains no business state.
- **Framework direction:** pluggable inbound adapters with raw-body/multipart
  parsing, provider signature verification, idempotency keys, and mapping steps.

## G-06 — Operational table features (P2)

- **Desired:** server filtering/sorting/pagination, persisted personal/team views,
  column configuration, safe bulk assignment/tagging, and CSV import/export.
- **Current behavior:** UX metadata describes a table but custom Liquid receives a
  bounded query result. There is no declarative saved-view entity convention or
  bulk workflow payload tied to selected rows.
- **Workaround:** the Accounts view offers useful local search/status/owner/stale
  filtering and selection across the loaded 250 rows. Selection deliberately has
  no mutation button.
- **Framework direction:** a first-class data-grid primitive whose bulk operations
  call semantic workflows per authorized row and report partial failures.

## G-07 — Map widget and public configuration (P2)

- **Desired:** a Google Maps canvas with candidate/customer markers, selection,
  clustering, and a safely bound browser key restricted by origin.
- **Current behavior:** page widgets do not include a map primitive and there is no
  documented public-vs-secret environment binding for file templates.
- **Workaround:** contained coordinate plot built from server-authorized query data.
  It demonstrates geographic selection without leaking a server API key or adding
  a bespoke frontend application.
- **Framework direction:** provider-neutral map widget with marker query, popup
  fields, actions, and explicitly public configuration bindings.

## G-08 — Application activity versus framework audit (P2)

- **Desired:** query framework audit by Account/Lead/Opportunity and project it into
  the CRM timeline without duplication.
- **Current behavior:** audit captures transport/workflow identity but is not an
  entity available to page queries. CRM users need a business-readable timeline.
- **Workaround:** immutable `Activity` rows for meaningful domain events. These do
  not replace the security audit.
- **Framework direction:** read-only filtered audit projections with resource links
  and actor/initiator fields.

## G-09 — Better Auth user profile and active state (P2)

- **Desired:** User includes active/inactive and team assignments and is queryable
  from manager pages.
- **Current behavior:** custom fields declared on `[entity.User]` are not real
  Better Auth columns, and User is not registered with the application query layer.
- **Workaround:** only real identity fields are declared; `TeamMembership` stores
  application relationships; demo roles are provisioned through a trusted database
  update. There is no honest active/inactive user field in this build.
- **Framework direction:** validated Better Auth additional fields plus read-only
  user queries and governed role/activation commands.

## Runtime bugs found

### B-01 — Nullable unique fields break fresh SQLite migration (P0)

- **Reproduction:** declare `{ name = "externalPlaceId", type = "Text", unique =
  true, nullable = true }` on Account and boot against an empty database.
- **Observed:** validation succeeds, but Drizzle migration fails on `CREATE UNIQUE
  INDEX ... external_place_id` with `no such column: external_place_id`; the table
  migration does not complete. `Message.sendGridId` has the same shape.
- **Workaround:** both external identifiers are indexed but not schema-unique. The
  inbound adapter and workflows must perform idempotency checks until fixed.
- **Expected:** nullable unique columns migrate on a fresh SQLite database and allow
  multiple nulls while rejecting repeated non-null external ids.

### B-02 — `Account` collides silently with Better Auth storage (P0)

- **Reproduction:** declare `[entity.Account]`, boot with email auth enabled, and
  create a CRM Account containing `name`.
- **Observed:** validation and migration both report success, but the generated
  entity resolves to Better Auth's existing `account` table. The first insert fails
  with `table account has no column named name`.
- **Workaround:** the internal blueprint entity is `CrmAccount`; all user-facing
  language, `/accounts` pages, and MCP paths remain Account.
- **Expected:** blueprint validation rejects collisions with framework-owned table
  names, or application tables are namespaced.

Live real-provider tests still require Google, SendGrid, and OpenAI credentials.
