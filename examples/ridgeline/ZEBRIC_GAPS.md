# Zebric gaps found while building Ridgeline Coffee

## 0.6.0 migration update

- Fixed: SQL-safe identifiers and reserved-name regression coverage.
- Fixed: order, shipment, and subscription lifecycle fields are command-only and transactional workflows invoke commands.
- Fixed: the Ridgeline API key declares its `staff` role rather than relying on a fallback grant.
- Still open: queryable auth users, richer order validation, aggregate inventory expressions, and audit projections.

This is the dogfooding ledger for the Zebric reimplementation of [Ridgeline
Coffee](../../../ridgeline), a Flask teaching app for a coffee roaster with
wholesale and retail customers. `ZEBRIC_GAP_ANALYSIS.md` in that repository is
a pre-implementation capability assessment; this document is the record of
what actually happened building `blueprint.toml` against the current runtime
source, including three real bugs found only by running the app end to end.
Priorities describe impact on the next Zebric release, not shortcuts to add
more Ridgeline-specific code.

## Gap summary

| Priority | Gap | Ridgeline consequence | 0.5 direction |
|---|---|---|---|
| P0 | SQL-reserved-word entity names | An entity named `Order` fails to boot the app at all | Quote generated identifiers, or validate entity names against the target dialect's reserved words |
| P0 | Custom fields on `[entity.User]` are silently dropped | A declared `customerId` field never reaches the real Better Auth table; no error at validate or boot time | Validate declared User fields against Better Auth's actual schema, or document the real column set |
| P0 | `[entity.User]` isn't a queryable entity | `entity = "User"` in a page query fails at request time with "Entity User not found" | Register Better Auth's table with the query executor (read-only), or reject `entity = "User"` at validate time |
| P1 | Relation-traversing access control | A page that queries a child record directly by foreign key (`OrderItem` by `orderId`) bypasses the parent's row-scoped `access.read` entirely | Let `access` conditions reach through a `belongsTo` relation, or document the denormalize-and-scope pattern as required |
| P1 | Workflow-only protected fields | CRUD permission sufficient for a guarded workflow to run is also sufficient for a direct write; no permission tier separates "the workflow's own session" from "any caller with that role" | Add command policies or workflow-only field writes enforced across UI, API, and MCP |
| P1 | Repeatable line items / fan-out creation | Achievable only via an undocumented `loop` workflow step, with quantities and load counts computed by the browser and trusted by the server | Document `loop`, and add a way to verify or recompute caller-submitted arithmetic server-side |
| P1 | Atomic inventory adjustment | Compare-and-set makes concurrent writes safe, but the delta itself (`newRemaining = expected - green`) is computed by the browser and not re-derived server-side | Typed expressions for arithmetic in workflow step data |
| P1 | Cross-field validation | Due date vs. requested ship date, and green weight vs. remaining lot weight, can only be checked in the browser | Server-side validation that compares two fields of the same submission or record |
| P1 | Derived value / lookup selection | Wholesale vs. retail unit price can't be selected from the chosen product's two prices inside a workflow | `findOne` (a real single-record projection; `find` returns an array today despite docs) plus typed expressions |
| P2 | Human-readable sequence numbers | `orderNumber`/`batchNumber` fall back to a prefix plus the record's ULID | Safe, transactional per-day counters |
| P2 | No page-level role gating | `/roasting`, `/inventory`, `/shipping` are reachable by any authenticated role; they render as empty rather than 403 | An `auth` value or page-level role list beyond `required`/`optional`/`none` |
| P2 | Detail-page 404s render as blank 200s | Visiting another customer's order (or a deleted one) returns a mostly-empty page, not 404 | A documented convention (or helper) for "no record matched" in custom templates |
| P2 | Hot reload doesn't re-register workflows or templates | A workflow precondition or `.liquid` file edit requires a full `zebric-engine` restart to take effect, even though the reload log reports success | Re-register workflow definitions and re-read file-backed templates on the same reload pass that already re-parses the blueprint |

## What was cleanly native

Entities, enums, relations, ULIDs, indexes, dual-layer RBAC (`entity.access`
plus `auth.permissions` role allow-lists), the lookup widget, scoped API keys
and skills, transactional workflows, compare-and-set conditional updates, and
the `loop` step for fan-out all worked as advertised once the issues below
were understood. Two techniques did a surprising amount of work with zero
platform gaps:

- **`entity.access.read` conditions apply automatically as row filters on every
  read**, not just single-record authorization checks. Declaring
  `read = { or = [{ role = staff }, { role = admin }, { customerEmail =
  "$currentUser.email" }] }` once on `SalesOrder` is enough for the dashboard,
  the orders list, and the order detail page to each show the right rows with
  no `where` clause of their own.
- **Liquid (`liquidjs`) is unrestricted**, not a sandboxed subset. `{% assign
  lineTotal = item.quantity | times: item.unitPrice %}`, a `for` loop with
  `assign`/`plus` for an order total, and `data.products | find: "id",
  item.productId` for a template-side join against a small reference list
  cover most of what teams reach for a "computed field" or `include` for.
  Order totals, line totals, low-stock/low-lot flags, and yield percentages
  in this app are all live template math over real stored fields, not
  denormalized or faked. This is worth documenting as the recommended pattern
  rather than something authors have to discover from the renderer source.

## G-01 — SQL-reserved-word entity names break the app (P0)

- **Desired behavior:** `[entity.Order]` creates a normal table.
- **What happened:** `zebric validate` accepted the blueprint, but
  `zebric-engine`'s first boot failed with `SqliteError: near "order": syntax
  error` from `CREATE TABLE order (...)`. `order` is a reserved SQL keyword;
  the runtime interpolates the lowercased entity name directly into DDL
  without quoting the identifier.
- **Workaround:** renamed the entity to `SalesOrder` (URLs stayed at
  `/orders/*`; only the blueprint entity name and its `Ref` targets changed).
- **Framework improvement:** quote generated table/column identifiers (a
  one-line fix in the Drizzle table builder), or have `zebric validate` warn
  on entity names that collide with a configured dialect's reserved words.
- **Acceptance test:** `zebric-engine` boots with an entity literally named
  `Order`, `Group`, `User`, or `Select`.

## G-02 — Custom `[entity.User]` fields are silently dropped (P0)

- **Desired behavior:** declaring `customerId` on `[entity.User]` (mirroring
  how `zebric-dispatch`'s blueprint documents the Better-Auth-owned shape)
  makes it a real, queryable column, so a customer login can be linked to its
  `Customer` account.
- **What happened:** Better Auth owns a real `user` table with a fixed column
  set (`id, name, email, emailVerified, image, role, createdAt, updatedAt`).
  `role` happens to be one of Better Auth's own columns, which is why
  `zebric-dispatch`'s pattern of setting it via `UPDATE user SET role = ...`
  in `seed.sh` works. `customerId` is not a Better Auth column, so the field
  is accepted by `zebric validate` and then silently has no effect: it's
  never persisted, and `session.user.customerId` is always `undefined`. There
  is no warning at validate time or at runtime.
- **Consequence:** every `access` condition written against
  `$currentUser.customerId` evaluates to "denied" for every customer, which
  in this app's early draft meant customers couldn't see their own orders,
  subscriptions, or account record at all -- a correctness bug that a
  schema-valid blueprint gave no signal about.
- **Workaround:** link a customer login to its account by **email** instead:
  `Customer.access.read = { or = [..., { email = "$currentUser.email" }] }`,
  and denormalize a `customerEmail` snapshot onto `SalesOrder`, `OrderItem`,
  `Shipment`, and `Subscription` at creation time so each can be scoped the
  same way (see G-04 for why the child tables need their own copy). Every
  seeded account's `Customer.email` matches the login it was created with, so
  no separate linking step is needed.
- **Framework improvement:** either validate declared `[entity.User]` fields
  against Better Auth's actual configured schema (reject or warn on fields
  that aren't real columns), or document the exact column set a
  Better-Auth-backed `User` entity may declare, and provide a supported way to
  add application-specific columns (e.g., a documented Better Auth plugin/
  `additionalFields` passthrough).
- **Acceptance test:** a field declared on `[entity.User]` that isn't part of
  Better Auth's schema either persists correctly or fails blueprint
  validation -- it must not silently no-op.

## G-03 — `[entity.User]` is not a queryable entity (P0)

- **Desired behavior:** a staff-facing `/admin/users` page can query `entity
  = "User"` like any other entity, for a directory listing.
- **What happened:** the query executor throws `Error: Entity User not
  found` at request time -- caught and logged, so the page renders with an
  empty result rather than crashing, but the intended feature silently does
  nothing. `zebric validate` does not catch this either, because entity
  references in queries are checked against `blueprint.entities`, which does
  include the declared `User` shape; the failure is specifically that the
  Node query executor's table registry (built from Drizzle-backed
  application entities) never registers Better Auth's separately-managed
  table.
- **Consequence:** there is no supported way to list, search, or administer
  Better-Auth-backed users from a blueprint page. Ridgeline's original
  `/admin/users` (list + create, with role and customer assignment) has no
  native equivalent; a create form would also bypass Better Auth's password
  hashing and session setup entirely, which is unsafe even if the write
  itself succeeded.
- **Workaround:** removed the page. Demo accounts are provisioned entirely by
  `seed.sh` via `/api/auth/sign-up/email` plus a direct `UPDATE user SET
  role = ...` (the same pattern `zebric-dispatch` uses).
- **Framework improvement:** expose Better Auth's user table as a read-only
  (at minimum) queryable entity, and provide a supported admin action for
  role assignment that goes through Better Auth rather than the generic
  entity API.
- **Acceptance test:** `[page."/admin/users"].query.users = { entity = "User"
  }` returns real accounts instead of an empty array with a logged error.

## G-04 — No relation-traversing access control (P1)

- **Desired behavior:** `OrderItem` and `Shipment` rows are visible only to
  the customer who owns the parent `SalesOrder` (or staff/admin), without
  duplicating that condition onto every child table.
- **What happened:** a page loading `/orders/:id` queries `OrderItem` and
  `Shipment` directly with `where = { orderId = "$params.id" }`. That query
  runs against the **child** entity's own `access.read`, which has no way to
  express "and the referenced SalesOrder must also be visible to me" -- access
  conditions can only compare the entity's own fields to `$currentUser.*`,
  never a related entity's fields. This was **found by testing**, not by
  inspection: an early draft left `OrderItem.access.read = "authenticated"`
  on the theory that "a customer only ever loads their own order id," which
  is false -- nothing stops a customer from requesting `/orders/<any-id>` and
  having the page's `OrderItem`/`Shipment` queries return the full line items
  and shipment detail of an order that isn't theirs, even though the order
  header itself was correctly hidden by its own row-scoped read condition.
- **Workaround:** denormalized `customerEmail` onto `OrderItem` and
  `Shipment` too (see G-02), snapshotted at creation from the same payload
  value used for the parent order, and scoped `access.read` on both the same
  way as `SalesOrder`. Verified with a live request as a customer session
  against another customer's order id: the order header renders blank and
  the items/shipments tables render empty, with no product, quantity, price,
  or shipment data leaked.
- **Framework improvement:** support a relation-aware access condition (e.g.
  `read = { "order.customerEmail" = "$currentUser.email" }`) so child
  entities don't need a duplicated ownership column purely for authorization.
  Until then, this pattern -- **any entity queried by foreign key on a page
  needs its own copy of the owner's identity for `access` to scope it** --
  deserves a callout in the security docs, since a schema-valid, request-
  succeeding blueprint can still leak data this way.
- **Acceptance test:** a customer session requesting another customer's
  order detail page receives no line-item or shipment data for that order,
  verified by inspecting the response body, not just the response's declared
  primary record.

## G-05 — Workflow-only protected fields (P1)

Same shape as `zebric-dispatch`'s G-01, confirmed again here with one
addition.

- **Desired behavior:** `SalesOrder.status` changes only through
  `ConfirmOrder`/`ShipOrder`/`DeliverOrder`/`CancelOrder`, which cascade to
  every `Shipment` in the same transaction and require a staff/admin
  session.
- **What worked:** compare-and-set `where` clauses
  (`where = { id = ..., status = "pending" }`) reject a stale transition; a
  `loop` step fans a status change out to every shipment on the order;
  `auth.permissions` grants `SalesOrder.update` only to `staff`/`admin`, so a
  customer's own signed request to `/actions/ConfirmOrder` on their own order
  is rejected with `403 Insufficient permissions for this workflow` even
  though the action bar button is also hidden client-side for them.
- **What did not:** `entity.access.update` has to stay permissive
  (`"authenticated"`) rather than `false`, because the workflow's own writes
  go through that same check using the triggering session -- there is no
  write path that is privileged relative to `entity.access`. Setting
  `access.update = false` on `SalesOrder` (to "obviously" block direct
  bypass) instead broke every guarded workflow's own update step, including
  the entity-triggered one that assigns `orderNumber`. This was caught only
  by running the workflow and reading the resulting `Access denied: Cannot
  update SalesOrder` error in the log -- `zebric validate` has no way to
  flag it.
- **New finding -- no permission tier for a record's own follow-up write:**
  `InitializeOrderNumber` (an entity-`create`-triggered workflow) and
  `ConfirmOrder` (a manual, staff-only workflow) both require the caller to
  hold `SalesOrder.update` under the same coarse `auth.permissions` check,
  because both are just "a workflow whose steps update SalesOrder." Granting
  a customer `SalesOrder.update` so their own order gets a formatted number
  after creation would also let that customer invoke `ConfirmOrder` directly.
  Correctly refusing to do that means a customer-placed order's
  `InitializeOrderNumber` follow-up permanently fails (verified: it retries
  three times, then fails, and `orderNumber` stays empty) -- a purely
  cosmetic but real consequence, worked around by falling back to
  `{{ order.orderNumber | default: order.id }}` in every template that shows
  it.
- **Framework improvement:** a permission tier for "the write this workflow
  itself performs as a direct effect of its own trigger" distinct from
  "any caller who can invoke workflows against this entity," so an
  entity-triggered follow-up doesn't have to be authorized as broadly as a
  manual, user-facing one.
- **Acceptance test:** an operator can invoke guarded completion, a customer
  cannot invoke it on their own order (403, not just a hidden button), and a
  customer's own order creation still succeeds even though its cosmetic
  reference number does not get assigned.

## G-06 — Repeatable line items and capacity-based fan-out (P1)

- **Desired behavior:** one order-creation submission with a variable number
  of product rows, and (for `delivery_truck`) automatically split into
  `ceil(totalCases / capacity)` shipment records.
- **What worked, and is undocumented:** `workflows.mdx` documents `query`,
  `condition`, `notify`, and `webhook` step types. The Node executor
  (`workflow-executor.ts`) also implements `email`, `webhook`, `plugin`,
  `loop`, and `delay` -- all real, tested code paths, not stubs.
  `zebric-dispatch`'s own `ZEBRIC_GAPS.md` lists `loop` among the executor's
  built-in step types in passing, but it is absent from the published
  reference. This example leans on `loop` directly: `CreateOrderWithItems`
  is one `transactional = true` workflow with a `create SalesOrder` step
  (`assignTo = "order"`), then a `loop` over `variables.data.payload.items`
  creating one `OrderItem` per row, then a `loop` over
  `variables.data.payload.shipments` creating one `Shipment` per truck load.
  Verified end to end: a 260-case order against a 100-case-capacity carrier
  produces shipment rows for loads of 100, 100, and 60 in one atomic request.
  The same `loop` pattern drives the order-status-cascade workflows in G-05.
- **What did not:** the browser, not the blueprint, computes the item array
  and the `ceil(totalCases / capacity)` load split (`order-new.liquid`'s
  inline script) and submits both as JSON in the action payload's hidden
  field. The workflow trusts that array; there is no server-side
  recomputation or verification that the submitted loads actually sum to the
  submitted item quantities, or that a load doesn't exceed the named
  carrier's capacity.
- **Framework improvement:** document `loop` (and `email`/`plugin`/`delay`)
  in `workflows.mdx`, and consider a documented way to re-derive or validate
  caller-submitted collections against a server-known constraint (e.g. the
  referenced `TruckingService.capacityCases`) before the fan-out runs.
- **Acceptance test:** a 260-case truck order against a 100-case carrier
  produces loads of 100, 100, and 60 in one transaction; an order with zero
  line items is rejected by the client and never reaches the workflow.

## G-07 — Atomic inventory adjustment (P1)

- **Desired behavior:** logging a roast batch atomically deducts green
  coffee from its lot and adds finished bags to product stock, and two
  concurrent roasts against the same lot cannot overdraw it (acceptance test
  #9 in `ZEBRIC_GAP_ANALYSIS.md`).
- **What worked:** the same compare-and-set `where` clause from G-05, applied
  to a value rather than a status. `LogRoastBatch`'s update steps use
  `where = { id = ..., weightKgRemaining = "{{ payload.expectedRemainingKg
  }}" }` with `data = { weightKgRemaining = "{{ payload.newRemainingKg }}"
  }`, inside a `transactional = true` workflow. Verified directly: submitting
  a stale `expectedRemainingKg` (150 kg, when the lot actually had 210 kg
  remaining) failed the whole workflow with `Conflict: GreenCoffeeLot ...
  no longer matches the expected state` and rolled back the `RoastBatch`
  create in the same transaction; resubmitting with the correct current
  value succeeded and left the lot and product stock consistent. This is a
  real, general-purpose optimistic-concurrency guarantee against lost
  updates and overdrawing, using only documented `updateWhere` semantics.
- **What did not:** the *arithmetic* -- `newRemainingKg = expectedRemainingKg
  - greenWeightKg` and `bagsProduced = floor(roastedKg * 1000 /
  bagWeightG)` -- is computed by the browser (`roasting.liquid`'s inline
  script), not the workflow. The compare-and-set guarantees the write can't
  race or overdraw *relative to the value the client actually read*, but the
  server never independently re-derives or checks that the submitted delta
  is arithmetically correct for the submitted `greenWeightKg`.
- **Framework improvement:** typed expressions usable in workflow step
  `data` (arithmetic, floor/ceiling) so the delta itself is computed and
  verifiable server-side, with compare-and-set still handling concurrency.
- **Acceptance test:** two sequential submissions against the same lot, the
  second using the first's now-stale expected weight, produce one successful
  write and one rejected conflict -- never a silent overdraw.

## G-08 — Cross-field validation (P1)

- **Desired behavior:** reject a delivery due date before the requested ship
  date, and a roast batch's green weight greater than its lot's remaining
  weight, at submission time.
- **What worked:** a workflow `precondition` can compare one field to a
  **literal** value (`"variables.data.record.status" = "pending"`), and
  `conditions.ts` supports `$gt`/`$gte`/`$lt`/`$lte` for that comparison.
- **What did not:** a precondition's `evaluateCondition` never templates its
  "expected" side, so it cannot compare two fields of the *same* submission
  to each other (`payload.dueDate` vs. `payload.requestedShipDate`, or
  `payload.greenWeightKg` vs. the referenced lot's stored
  `weightKgRemaining`). This is the same limitation `zebric-dispatch`'s
  G-07 hits from a different angle (no reliable way to compare two dynamic
  values inside a workflow at all).
- **Workaround:** client-side checks only (`order-new.liquid` shows an
  inline warning, does not block submit; `roasting.liquid` blocks submit
  client-side but the server would still accept an inconsistent pair if
  called directly).
- **Framework improvement:** form/workflow validation capable of comparing
  two submitted fields, or two dynamic values generally, and returning a
  field-specific error.
- **Acceptance test:** `POST /actions/LogRoastBatch` with a `greenWeightKg`
  exceeding the lot's actual current `weightKgRemaining` is rejected by the
  server, not only warned about in the browser.

## G-09 — Derived value / lookup selection inside a workflow (P1)

Same root cause as `zebric-dispatch`'s G-07, hit here for pricing rather than
category-to-workflow selection.

- **Desired behavior:** an order item's `unitPrice` is selected from the
  chosen product's `wholesalePricePerCase` or `retailPricePerBag` depending
  on the order's `orderType`, inside the create workflow.
- **What did not work:** `workflows.mdx` documents a `findOne` query action;
  the Node executor's `case 'find'` (there is no `findOne` case at all)
  returns an **array** from `dataLayer.execute`, and workflow context has no
  populated `steps.N.result` for a `condition` step's `if` to branch on (the
  executor only exposes a step's result via an explicit `assignTo` name, and
  even then only as whatever shape the step produced -- an array for `find`).
  So neither `findOne` nor array-indexed template interpolation
  (`{{ steps.0.result.0.field }}`) is available to project a single field out
  of a looked-up record inside a workflow step.
- **Workaround:** the browser reads both prices off the already-fetched
  product list and the selected `orderType`, and submits the resolved
  `unitPrice` directly in the item payload; the workflow just stores what it
  is given.
- **Framework improvement:** implement `findOne` as documented, and expose
  step results at a stable `steps.N.result` (or equivalent) path so a later
  `condition`/template step can branch on and project from them.
- **Acceptance test:** a wholesale order's item workflow step can look up a
  product by id and select `wholesalePricePerCase` without the caller
  supplying the resolved number.

## G-10 — Human-readable sequence numbers (P2)

Same gap as `zebric-dispatch`'s G-09/P2, confirmed again.

- **Desired behavior:** `WS-20261001-003`-style daily sequence numbers for
  orders and batches.
- **Workaround:** `InitializeOrderNumber`/`InitializeRoastBatchNumber` are
  entity-`create`-triggered workflows that set `orderNumber`/`batchNumber`
  to a type-prefixed ULID (`WS-<id>` / `RT-<id>` / `RB-<id>`) immediately
  after creation -- unique and sortable by creation order, but not a
  human-countable daily sequence, and (see G-05) not guaranteed to run at
  all for every session.
- **Framework improvement:** collision-safe transactional counters/sequence
  fields.

## G-11 — No page-level role gating (P2)

- **Desired behavior:** `/roasting`, `/inventory`, `/shipping`, and
  admin-style pages are staff/admin only, matching the original Flask app's
  per-route `staff_only()` guard.
- **What happened:** `page.auth` only accepts `required`/`optional`/`none` --
  there is no role list. A `customer` session can load these pages; because
  every entity they query (`GreenCoffeeLot`, `RoastBatch`) is staff/admin-only
  at the `entity.access` level, the query executor's `isImpossibleFilter`
  path returns an empty result rather than throwing past the page's
  `try/catch`, so the pages render with empty tables instead of a 403 or a
  visible error. No data leaks, but the page is reachable and looks broken
  rather than forbidden.
- **Framework improvement:** an optional role list on `page.auth` (or a
  dedicated `page.roles`) so an unauthorized role gets a real 403 page.

## G-12 — Detail-page 404s render as blank 200s (P2)

- **Desired behavior:** requesting a nonexistent or inaccessible record's
  detail page (`/orders/<bad-id>`) returns 404.
- **What happened:** a single-record page query (`where = { id =
  "$params.id" }`) always returns an array via `queryExecutor.execute`, with
  no automatic unwrap; `zebric-dispatch`'s own templates handle this with
  `{% assign request = data.request[0] %}` at the top of the file, which
  this example follows once the pattern was noticed (missing it initially
  produced `{% assign customer = data.customers | find: "id",
  data.order.customerId %}` silently matching the wrong record, since
  `data.order.customerId` is `undefined` on an array and `find` treated that
  as "match nothing meaningful" and returned the first customer). With the
  array unwrapped correctly, a filtered-to-empty result renders as a page
  with blank fields and empty child tables -- a 200, not a 404.
- **Workaround:** none applied beyond the array-unwrap fix itself; still a
  UX gap for both a genuinely-missing id and one hidden by row-scoping.
- **Framework improvement:** either unwrap a single-record page query result
  automatically (with a documented naming convention, e.g. a query whose
  `where` pins `id`), or document the `data.<name>[0]` convention plainly in
  `blueprint.mdx` next to the Detail Page example, which currently implies
  `request.category.name` works without showing the unwrap step.

## G-13 — Hot reload doesn't re-register workflows or re-read file templates (P2)

- **Desired behavior:** editing `blueprint.toml` or a `.liquid` file referenced
  from it takes effect on the next request, matching the "Hot reload enabled"
  / "Blueprint reload complete" messages `zebric-engine` logs on every save.
- **What happened:** two changes made during this build were silently
  ignored by a running, "successfully reloaded" server and only took effect
  after killing and restarting the process:
  - fixing a buggy workflow `precondition` (`SetOrderDueDate` incorrectly
    required `role = "staff"`, excluding `admin`) kept failing with the old
    precondition's `409` for every request after the edit and a logged
    `Blueprint reload complete`, until the process was restarted;
  - editing `order-detail.liquid` and `account-detail.liquid` to fix the
    array-unwrap bug in G-12 rendered the *old* template content on every
    request until the process was restarted, with no reload message
    indicating the template file itself wasn't re-read.
  Page routing and entity schema changes did pick up correctly via hot
  reload in the same session -- this is specific to workflow definitions and
  file-backed (`type = "file"`) template sources.
- **Consequence for this project:** every workflow or template edit during
  development needed a full server restart to verify, which is easy to miss
  since the reload log gives no indication that anything was skipped.
- **Framework improvement:** either make hot reload actually re-register
  workflow definitions and re-read file-backed template sources, or have the
  reload log explicitly say which parts of the blueprint a hot reload can and
  can't apply without a restart.
- **Acceptance test:** editing a workflow's `precondition` or a `.liquid`
  file it uses, saving, and immediately re-running the request produces the
  new behavior without restarting the process.
