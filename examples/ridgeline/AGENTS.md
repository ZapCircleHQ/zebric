# Ridgeline Coffee contributor guidance

Ridgeline is a system of record for a small coffee roaster's orders,
inventory, and subscriptions, not a chat interface or a second agent-only
application.

- Keep entities, authorization, and lifecycle rules in `blueprint.toml`
  whenever Zebric can express them.
- Agent actions use the same records and workflow guards as human actions.
- Never expose direct status mutation (order status, subscription status) as
  an agent or UI convenience -- always go through a guarded workflow.
- A customer login is linked to its account by email, not a `customerId`
  field on `User` (Better Auth's real table doesn't have one -- see
  `ZEBRIC_GAPS.md` G-02). Any new customer-scoped entity needs its own
  `customerEmail` snapshot; row-scoping does not traverse relations (G-04).
- Prefer a documented gap over fake framework behavior or
  application-specific infrastructure (no companion service, no changes
  outside this directory).
- Update `ZEBRIC_GAPS.md` when a workaround reveals a reusable platform
  need, and when you find a bug that only shows up by running the app (this
  example already has three: a SQL-reserved-word entity name, a silently
  dropped `User` field, and a child-record row-scoping leak).
