# Zebric CRM gap ledger

This is the implementation ledger for `examples/crm`, not a wishlist written in
advance. Priorities reflect correctness and production impact. Workarounds are
kept visible even when the demo succeeds.

## Summary

| Priority | Gap | CRM consequence | Workaround |
|---|---|---|---|
| P0 | Delegated agent row authorization | Static agent keys cannot inherit Sarah's or Mike's team visibility | Broad agent row access plus narrow action scopes; production blocker |
| P1 | Relation-aware team access | Membership rows cannot authorize related CRM rows | Snapshot `ownerId` and one `assistantEmail` on every scoped entity |
| P1 | Workflow-only protected fields | Roles able to run transitions can also call generic entity update | Do not expose generic writes in UI/skill; guarded compare-and-set workflows |
| P1 | Typed external-response transforms | Places dedupe/count and LLM JSON parsing are not robustly expressible | Stage results; explicit duplicate review; reviewed classification command |
| P1 | SendGrid Inbound Parse mismatch | Native webhook expects JSON plus Zebric auth, not SendGrid multipart | Narrow deployment-edge normalization adapter required |
| P2 | Data-grid composition | No saved views, CSV, safe bulk commands, or inline-edit policy | Local filter/selection enhancement; no fake bulk mutation |
| P2 | Browser integration configuration | No secret-safe Maps widget/key binding | Coordinate fallback view; production map left as explicit gap |
| P2 | Queryable framework audit | UI cannot project audit records into account timelines | Append immutable application `Activity` for business events |
| P2 | User application profile | Better Auth User cannot hold `active` or team fields and is not queryable | TeamMembership entity; seed roles through trusted DB write |
| P3 | Human-readable references | No transactional sequence primitive | Use stable ULIDs/seed ids |

## G-01 — Delegated agent authorization (P0)

- **Desired:** an agent acting for Sarah receives exactly Sarah's AE/team rows,
  and audit retains both Sarah as initiator and the agent as executor.
- **Current behavior:** API-key principals have their own `agentId`, scopes, and
  declared constraints, but the compatibility user has no `role`. Runtime
  resource/row constraints are not enforced, and a key cannot inherit a human
  session.
- **Consequence:** owner rules comparing `ownerId = $currentUser.id` return no
  human-owned rows. Granting the `user` role broad row access makes the north-star
  demo usable but is not equivalent authorization.
- **Workaround:** every scoped row carries `agentAccessId = "crm-sales-agent"` and
  access compares it to the principal id. Only semantic skill routes are exposed
  and scopes remove approval permission. The README labels the key development-only.
- **Framework direction:** delegated principals containing initiator and executor,
  with enforced row constraints that access conditions can reference.
- **Acceptance:** Sarah-delegated and Mike-delegated agents receive disjoint list
  results, while audit stores both principal identities.

## G-02 — Relation-aware authorization (P1)

- **Desired:** `Account.team.memberships` determines AE/assistant access and any
  number of assistants can support a team.
- **Current behavior:** entity access conditions compare only fields on the current
  row with primitive `$currentUser` fields. They cannot traverse `team` or ask
  whether a membership record exists.
- **Consequence:** every Account, Contact, Lead, Opportunity, Activity,
  Conversation, Message, Task, ProspectSearch, ProspectCandidate, and Insight
  needs copied ownership data. The demo supports one authorization assistant per
  row even though `TeamMembership` models more.
- **Workaround:** `ownerId` plus `assistantEmail` snapshots and manager/admin role
  branches. Outreach approval also requires the `assistant`, `manager`, or `admin`
  role and row access to the message. This is secure for the declared snapshot but
  creates reassignment fanout and cannot distinguish two assistants on one team.
- **Framework direction:** relation/exists predicates in access filters, evaluated
  identically by list, detail, API, workflow, and MCP paths.

## G-03 — Workflow-only lifecycle fields (P1)

- **Desired:** stage, approval, classification, disposition, and insight status can
  only change through named domain commands.
- **Current behavior:** a workflow's writes use the caller's same entity update
  permission. Setting update false also blocks the workflow; granting it permits a
  direct entity update route.
- **Workaround:** skills and custom UI expose only workflows; workflows use
  preconditions and compare-and-set `where` clauses. Generic APIs remain a boundary
  an authorized caller could abuse.
- **Framework direction:** command-only fields or workflow-capability writes, with
  direct CRUD rejected across all transports.

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
