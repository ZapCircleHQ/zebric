# Zebric Dispatch contributor guidance

Dispatch is the operational system of record, not a chat interface or a second agent-only application.

- Keep entities, authorization, and lifecycle rules in `blueprint.toml` whenever Zebric can express them.
- Agent actions use the same records and workflow guards as human actions.
- Never expose direct status mutation as an agent convenience.
- Stop protected access or purchasing work at a pending approval boundary.
- Record meaningful agent progress in Request comments/activity.
- Prefer a documented gap over fake framework behavior or application-specific infrastructure.
- Update `ZEBRIC_GAPS.md` when a workaround reveals a reusable platform need.
