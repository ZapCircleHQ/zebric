# Ridgeline Coffee (Zebric)

A Zebric reimplementation of [Ridgeline Coffee](../../../ridgeline), a Flask
teaching app for a small coffee roaster with wholesale accounts (cafes,
hotels, offices buying by the case) and retail subscribers (buying bagged
coffee, some on a recurring subscription).

It covers the same domain as the original: green-coffee inventory, roast
logging, wholesale/retail orders with capacity-split truck shipments,
subscriptions, and staff/customer accounts -- built entirely from
[`blueprint.toml`](blueprint.toml) plus the Liquid templates in
[`templates/`](templates). The ownership model uses native membership policies
and immutable ownership links in the workspace runtime.

[`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md)
is the record of what actually happened building it, including three real
bugs (a SQL-reserved-word entity name, silently-dropped custom fields on
`User`, and a row-scoping leak on child records) found only by running the
app end to end.

## What is included

- Green coffee lots, roasted products, and roast batches, with atomic,
  concurrency-safe inventory adjustment when a batch is logged.
- Wholesale (by the case) and retail (by the bag) orders, created with a
  variable number of line items and shipment records in one atomic
  transaction -- including capacity-based delivery-truck load splitting
  (verified: a 260-case order against a 100-case-capacity carrier produces
  three loads of 100, 100, and 60).
- Order status workflows (`pending -> confirmed -> roasting -> shipped ->
  delivered`, or `cancelled`) that cascade to every shipment on the order in
  the same transaction, and are guarded so only staff/admin can invoke them
  -- verified against a customer session on their own order (403).
- Recurring retail subscriptions with pause/resume/cancel.
- Wholesale and retail accounts, a staff directory with a customer/account
  lookup widget, warehouses, and trucking services.
- Email/password authentication with `admin`, `staff`, and `customer` roles,
  row-scoped so a customer sees only their own orders, subscriptions, and
  account.
- A `ridgeline` agent skill exposing bounded read/transition operations
  instead of unrestricted status mutation.

## Run

From the repository root (Node.js 22+, pnpm, Python 3, and `sqlite3`):

```bash
pnpm install
```

The development command builds the CLI and its runtime dependencies before starting.

```bash
pnpm --filter ridgeline-coffee dev
```

In a second terminal:

```bash
pnpm --filter ridgeline-coffee seed
```

Open <http://127.0.0.1:3000>. Every demo account uses `RidgelineDemo1!` by
default:

| Role | Email | Notes |
|---|---|---|
| Admin | `admin@ridgelinecoffee.com` | Full access |
| Staff | `maria@ridgelinecoffee.com` | Roastery ops |
| Staff | `devon@ridgelinecoffee.com` | Roastery ops |
| Customer | `orders@northsidecafe.com` | Wholesale -- Northside Cafe (Pittsburgh) |
| Customer | `orders@mapleandco.ca` | Wholesale -- Maple & Co (Toronto, CAD) |
| Customer | `jsmith@example.com` | Retail -- active + paused subscriptions |
| Customer | `ana.ruiz@example.com` | Retail -- active subscription |

Set `DEMO_PASSWORD`, `BASE_URL`, or `DB_PATH` to override seed defaults. The
seed is idempotent once `cust_northside` exists.

## Authentication and authorization

Better Auth owns identity and sessions. `CustomerMembership` explicitly links
its stable user IDs to `Customer.id`; only admins can create or revoke these
links. A user can belong to multiple accounts, and an account can have multiple
users. Emails remain contact information. Changing a login or contact email
neither grants nor revokes access.

Orders and subscriptions authorize through `customer.memberships.userId`;
items and shipments traverse `order.customer.memberships.userId`. Warehouses
are scoped to their account too. The server loads these relations from stored
records and ignores embedded customer/member objects in a request. This applies
to generic API writes as well as workflows and commands.

Creation workflows look up the selected account under the authenticated session
and use its stored ID and account type. Child records receive the newly created
order's ID. There are no `customerEmail` ownership snapshots. Customer and parent
references use `immutable = true`, so an update cannot reassign a record to
another account. A truck shipment's warehouse must belong to its order's account.

Order status changes only through guarded workflows
(`ConfirmOrder`/`ShipOrder`/`DeliverOrder`/`CancelOrder`/
`StartRoastingForOrder`), each requiring a staff/admin session via
`auth.permissions` and a compare-and-set precondition against the order's
current status. Lifecycle fields on orders, shipments, and subscriptions
use `write = "command-only"`; their workflows invoke domain commands within
a transaction. Generic CRUD writes to those fields are rejected even when
the caller has entity update permission. Shipment commands also require the
corresponding order workflow. G-05 in [`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md)
records the original gap and its resolution.

## Existing databases

Start the rebuilt app to create `CustomerMembership`, then rerun the seed script
for an existing demo database. It provisions the four explicit demo memberships
even when operational fixtures already exist. Old `customerEmail` columns may
remain in SQLite but are no longer read or used for authorization.

For other databases, an admin must provision each reviewed `{ customerId, userId }`
link through `/api/customermemberships` before customer access resumes. Use actual
Better Auth user IDs. There is no automatic email-based account claim or migration.
Revoke access by deleting the membership; existing sessions lose account access
on their next request. Membership keys themselves cannot be updated.

## Connect an agent

Start the app with a credential:

```bash
export RIDGELINE_AGENT_API_KEY='replace-with-a-long-random-secret'
pnpm --filter ridgeline-coffee dev
```

Use the normal Zebric MCP/agent connection for the running engine and supply
that bearer credential. The generated `ridgeline` skill covers pending
orders, order detail, due-date/status transitions, low-stock and
green-coffee-lot reads, recent roast batches, product search, account
lookup, and subscription pause/resume -- narrower than Ridgeline's original
single shared API key, and without a generic status-mutation action.

## Validate

```bash
pnpm --filter ridgeline-coffee validate
pnpm --filter ridgeline-coffee test
```

The smoke test starts an isolated server and temporary database, runs the seed,
checks staff pages and order/shipment transitions, and verifies customer row
scoping, subscription actions, forged IDs/relations, membership provisioning and
revocation, email changes, and rejection of ownership/lifecycle reassignment. Set
`SMOKE_PORT` to override its default port (4930; admin port is 30 higher).

## Dogfooding

Ridgeline is intentionally both a useful example and a framework probe.
[`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md) records what is native (including two
undocumented-but-real capabilities this app leans on: the workflow `loop`
step, and unrestricted Liquid math/array filters standing in for computed
fields), what needed a workaround, and three bugs that only surfaced by
running the seeded app and testing both roles' access directly rather than
by reading the blueprint. The gaps are part of the deliverable, not hidden
implementation debt.
