# Customer Lookup — Shared Control Example

Demonstrates the Zebric **control** concept: the same interactive primitive (`lookup`) mounted two different ways with identical config. One blueprint exercises both mount points end-to-end.

## What it shows

- **Mount 1 — form field** (`/orders/new`): when picking a customer for a new order, start typing a last name or email; the dropdown appears, arrow-keys and Enter pick one, the picked customer's id is what gets submitted with the form.
- **Mount 2 — widget** (`/search`): a standalone search page. Pick a customer → `on_select.navigate` sends the browser to `/customers/<id>`.

Both mounts share one HTML renderer, one client initializer, one server endpoint (`GET /_widget/search`), and one config schema.

## Run

```bash
pnpm --filter customer-lookup-example dev
# in another terminal:
pnpm --filter customer-lookup-example seed
```

Then:

- Form mount: http://localhost:3000/orders/new
- Widget mount: http://localhost:3000/search

## Blueprint shape — same config, two places

```toml
# As a form field — nested lookup block attaches to the preceding array entry
[[page."/orders/new".form.fields]]
name = "customerId"
type = "lookup"
required = true

  [page."/orders/new".form.fields.lookup]
  entity  = "Customer"
  search  = ["lastName", "firstName", "email"]
  display = "{lastName}, {firstName} — {email}"
  limit   = 10

# Equivalent inline-table form (useful when you have multiple lookups per form)
# [[page."/orders/new".form.fields]]
# name = "customerId"
# type = "lookup"
# required = true
# lookup = { entity = "Customer", search = ["lastName", "firstName"], display = "{lastName}, {firstName}" }

# As a standalone widget
[page."/search".widget]
kind    = "lookup"
entity  = "Customer"
search  = ["lastName", "firstName", "email", "company"]
display = "{lastName}, {firstName} — {company}"
limit   = 10

[page."/search".widget.on_select]
navigate = "/customers/$to.id"
```

## Contract this exercises

- `type = "lookup"` (form field) and `kind = "lookup"` (widget) both resolve against the same control registry — single namespace.
- Control config nested under the mount (`form.fields.<name>.lookup` and `widget` keys).
- `/_widget/search?page=...&field=...&q=...` resolves config from the blueprint by page+field.
- Client runtime auto-included on any page with a control (widget **or** form field).

## Limitations of this first slice

- No create-on-the-fly ("Add 'John Smith'" if no match). Deferred by design.
- On form submit with a lookup in edit mode, the stored id re-renders as the visible label literal — production code would resolve the label server-side before render. Create-only forms work fine.
- No dependent lookups yet (e.g., contact filtered by selected customer). The `filter` config key is wired in the config schema but untested against form-state.
