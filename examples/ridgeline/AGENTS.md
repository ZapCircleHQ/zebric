# Ridgeline Coffee contributor guidance

Ridgeline is a system of record for a small coffee roaster's orders,
inventory, and subscriptions, not a chat interface or a second agent-only
application.

- Keep entities, authorization, and lifecycle rules in `blueprint.toml`
  whenever Zebric can express them.
- Agent actions use the same records and workflow guards as human actions.
- Never expose direct status mutation (order status, subscription status) as
  an agent or UI convenience -- always go through a guarded workflow.
- Link logins to accounts with admin-provisioned `CustomerMembership` records
  keyed by stable Better Auth user IDs. Email is contact data, never ownership.
- Authorize scoped records through declared relations to stored memberships,
  including child -> order -> customer traversal. Never trust embedded relation
  objects or identity snapshots supplied by a browser.
- Keep account and parent links immutable after creation. Creation workflows
  must resolve the selected account under the caller's session and copy stored
  values; child records use the server-created parent's ID.
- Prefer a documented gap over fake framework behavior or
  application-specific infrastructure (no companion service). Reusable server
  security guards belong in the shared runtime; keep domain rules here.
- Update `ZEBRIC_GAPS.md` when a workaround reveals a reusable platform
  need, and when you find a bug that only shows up by running the app (this
  example already has three: a SQL-reserved-word entity name, a silently
  dropped `User` field, and a child-record row-scoping leak).
