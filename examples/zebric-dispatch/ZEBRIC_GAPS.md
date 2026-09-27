# Zebric gaps found while building Dispatch

This is the dogfooding ledger for the updated Dispatch PRD. Priorities describe impact on the next Zebric release, not shortcuts to add more Dispatch-specific code.

## Gap summary

| Priority | Gap | Dispatch consequence | 0.5 direction |
|---|---|---|---|
| P0 | Workflow-only mutations / domain commands | CRUD permission sufficient for a workflow also permits direct protected-field updates | Add command policies or workflow-only field writes enforced across UI, API, and MCP |
| P0 | Approval decision authorization | RBAC identifies an approver role but cannot constrain a decision to `requestedFromId == currentUser.id` | Support cross-entity, record-aware workflow authorization |
| P0 | Agent principal roles | API-key actors receive the fallback `user` role | Add role(s) to API-key principals and use the same RBAC evaluator as human sessions |
| P1 | Framework audit as application data | Request detail cannot query the authoritative audit log | Expose a permission-aware audit query primitive with projection hooks |
| P1 | Contextual workflow forms | Assign/request-approval inputs require custom HTML and payload JavaScript | Let actions declare typed inputs, lookups, validation, and confirmation |
| P1 | Auth-user relationships | Assignee/requester display needs duplicated names and raw user IDs | Make the auth `User` model available as a relation and lookup source |
| P1 | Derived workflow selection | Category-managed `workflowKey` cannot be projected cleanly into a new Request | Add expressions/derived fields or scalar `findOne` results |
| P1 | Query composition and search | Request filters are client-side over a bounded result set | Add optional predicates, OR text search, and saved views |
| P1 | Shared database configuration | `database.url` and auth can silently open different SQLite files | Resolve one database target for schema, queries, and authentication |
| P2 | Custom-view component reuse | Three Liquid pages repeat CSS and manually reproduce action forms | Add includes/components and render helpers |
| P2 | Human-readable sequences | Request numbers fall back to `DSP-<ULID>` outside seed data | Add safe counters/sequence fields |
| P2 | Relationship-aware agent reads | Full context takes four semantic reads | Support includes/result composition in skill actions |

## G-01 — Workflow-only protected fields (P0)

- **Desired behavior:** `Request.status`, `approvalState`, and `completedAt` may change only through valid workflows. UI, API, and MCP must not bypass approval.
- **Relevant capability:** entity/field access, RBAC, workflow preconditions, conditional updates, and agent scopes.
- **What worked:** workflow preconditions fail closed; compare-and-set `where` clauses reduce stale transitions; scopes expose only semantic agent transitions.
- **What did not:** the initiating principal needs `Request.update` for a manual workflow, which also authorizes the generic update route. Field access cannot distinguish workflow writes from direct writes.
- **Workaround:** omit generic update from the Dispatch skill/UI, guard every transition, and mirror approval state onto `Request` for protected completion checks.
- **Framework improvement:** domain commands or workflow-only field writes enforced in every adapter.
- **Acceptance test:** an operator can invoke guarded completion after approval, while direct `PUT /api/requests/:id {status:"completed"}` is always denied.

## G-02 — Record-aware approval authorization (P0)

- **Desired behavior:** only the pending approval's `requestedFrom` user, or an admin, may decide it.
- **Relevant capability:** conditional RBAC and workflow permission preflight.
- **What worked:** decision workflows require an `approver`/`admin` session and pending request state.
- **What did not:** preflight checks entity/action pairs without loading the secondary Approval row, so it cannot compare the payload's Approval to the current user.
- **Workaround:** role gate plus Inbox filtering. This is suitable for demonstration but broader than intended.
- **Framework improvement:** typed workflow inputs and an authorization phase that transactionally resolves referenced records before effects.

## G-03 — Agent roles (P0)

- **Desired behavior:** API-key principals have explicit application roles as well as scopes.
- **Relevant capability:** `auth.apiKeys`, agent scopes, and RBAC.
- **What worked:** scopes limit skill routes and stable agent/credential/run attribution is recorded.
- **What did not:** API-key sessions have no application role, so RBAC assigns fallback `user`.
- **Workaround:** a scoped `user` role grants underlying operator workflow writes. No decision skill is exposed.
- **Framework improvement:** support `roles = [...]` on API keys and evaluate role, scope, and resource constraints together.

## G-04 — Audit projection (P1)

- **Desired behavior:** show framework-recorded human, agent, workflow, and system events together on Request detail.
- **Relevant capability:** security audit logger, workflow-job audit, and agent attribution.
- **What worked:** authoritative events are recorded outside application tables.
- **What did not:** blueprint queries cannot read or project them into a request timeline.
- **Workaround:** immutable-by-policy `RequestActivity` presentation records. Framework audit remains authoritative.
- **Framework improvement:** a read-only AuditEvent virtual entity with permission, correlation/entity filters, and presentation metadata.

## G-05 — Contextual workflow inputs (P1)

- **Desired behavior:** Assign and Request approval open typed forms with user lookup and validation.
- **Relevant capability:** action bars, forms, and controls.
- **What worked:** action visibility is declared and rechecked server-side; CRUD forms have query-backed controls.
- **What did not:** actions have only static payloads and forms cannot invoke workflows.
- **Workaround:** two small Liquid forms serialize inputs into the action endpoint payload.
- **Framework improvement:** `action.input` or `form.method = "workflow"` using the current controls and validation system.

## G-06 — Auth users as domain references (P1)

- **Desired behavior:** requester, assignee, requestedFrom, and author are real auth-user relations with lookup/display support.
- **Relevant capability:** Ref, relations, Better Auth's user table, and lookup controls.
- **What worked:** declaring the User shape validates Ref fields and auto-populates requester/author IDs.
- **What did not:** auth-owned User is not a dependable blueprint query/relationship source. Names must be snapshotted.
- **Workaround:** identity IDs plus display-name snapshots; seed resolves real auth IDs.
- **Framework improvement:** expose auth users as a read-limited system entity and lookup source.

## G-07 — Category-driven workflow derivation (P1)

- **Desired behavior:** any administrator-managed category selects its configured workflow on Request creation.
- **Relevant capability:** query steps, `assignTo`, interpolation, and entity triggers.
- **What worked:** stable built-in category IDs can trigger access/purchase selection.
- **What did not:** `find` returns an array and interpolation cannot reliably project a named property from its first record; no derived/reference expression exists.
- **Workaround:** seeded protected categories use stable IDs and explicit triggers. New categories default to general until the blueprint changes.
- **Framework improvement:** `findOne`, array indexing, typed expressions, and eventually computed relation projections.

## G-08 — Operational query UX (P1)

- **Desired behavior:** server-side search and composable Open/Mine/Created/Waiting/Completed views.
- **Relevant capability:** page queries and list layouts.
- **What worked:** static filters, ordering, limits, and current-user placeholders.
- **What did not:** queries cannot conditionally omit predicates, OR-search fields, or declare saved views.
- **Workaround:** the Requests surface filters up to 250 rows client-side.
- **Framework improvement:** query parameter schemas, optional predicates, `$search`, saved views, and pagination state.

## G-09 — Shared database configuration (P1)

- **Desired behavior:** supplying `database.url` configures both application data and Better Auth.
- **Relevant capability:** engine database configuration and auth initialization.
- **What worked:** the default development path uses `./data/app.db` for both systems.
- **What did not:** runtime validation with a custom `database.url` created application tables in that file while auth still opened `dev.dbPath` or `./data/app.db`, producing `no such table: user`.
- **Workaround:** local validation uses `dev.dbPath`; normal Dispatch startup uses the shared default path.
- **Framework improvement:** resolve the database target once and inject it into every subsystem, with a startup assertion that auth and the query executor share the intended database.

## What was cleanly native

Entities, enums, timestamps, indexes, relations, authenticated pages, email sessions, role declarations, scoped API keys, transactional multi-entity workflows, preconditions, conditional updates, trigger-cycle protection, query-backed form options, file-backed Liquid, semantic skill actions, risk labels, attribution, and job polling all fit cleanly.

Those strengths keep Dispatch predominantly one understandable blueprint despite the gaps above.
