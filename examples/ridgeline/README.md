# Ridgeline Coffee (Zebric)

A Zebric reimplementation of [Ridgeline Coffee](../../../ridgeline), a Flask
teaching app for a small coffee roaster with wholesale accounts (cafes,
hotels, offices buying by the case) and retail subscribers (buying bagged
coffee, some on a recurring subscription).

It covers the same domain as the original: green-coffee inventory, roast
logging, wholesale/retail orders with capacity-split truck shipments,
subscriptions, and staff/customer accounts -- built entirely from
[`blueprint.toml`](blueprint.toml) plus the Liquid templates in
[`templates/`](templates), with no changes to the base Zebric packages.

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

From the repository root:

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

Zebric's email provider owns identity and sessions. `[entity.User]` declares
only fields that are real Better Auth columns (`id`, `email`, `name`, `role`,
timestamps) -- an earlier draft also declared a `customerId` field, which
Better Auth silently dropped with no validation error (see
[`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md) G-02). A customer login is linked to its
`Customer` account by matching **email address** instead, and that same
email is snapshotted onto every order, order item, shipment, and
subscription at creation time so each can be row-scoped without a
relation-traversing access condition (which Zebric doesn't support -- G-04).

Order status changes only through guarded workflows
(`ConfirmOrder`/`ShipOrder`/`DeliverOrder`/`CancelOrder`/
`StartRoastingForOrder`), each requiring a staff/admin session via
`auth.permissions` and a compare-and-set precondition against the order's
current status. As with `zebric-dispatch`, this is not an airtight
domain-command boundary: `entity.access.update` has to stay permissive for
the workflow's own write to succeed, so the real guarantee comes from no
page or skill exposing a generic update route. See G-05 in
[`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md).

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
```

## Dogfooding

Ridgeline is intentionally both a useful example and a framework probe.
[`ZEBRIC_GAPS.md`](ZEBRIC_GAPS.md) records what is native (including two
undocumented-but-real capabilities this app leans on: the workflow `loop`
step, and unrestricted Liquid math/array filters standing in for computed
fields), what needed a workaround, and three bugs that only surfaced by
running the seeded app and testing both roles' access directly rather than
by reading the blueprint. The gaps are part of the deliverable, not hidden
implementation debt.
