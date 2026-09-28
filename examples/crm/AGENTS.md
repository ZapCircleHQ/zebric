# Zebric CRM contributor guidance

This CRM is a governed system of record shared by humans and agents.

- Keep entities, authorization, lifecycle rules, and integrations in `blueprint.toml` when Zebric can express them.
- Expose semantic workflows to agents; never offer direct stage, approval, disposition, or insight-status mutation as a convenience.
- Outbound messages that require review must stop at `pending` until an authorized assistant or manager approves them.
- Keep Google Places candidates separate from authoritative Accounts and Leads until promotion.
- Preserve human initiator, agent executor, source, and external identifiers wherever the current framework makes them available.
- Do not add CRM-specific branches to framework packages. Document gaps in `ZEBRIC_GAPS.md`.
- Treat `ownerId`, `assistantEmail`, and `agentAccessId` as authorization snapshots. New team-scoped entities need all three until relation-aware/delegated access rules exist.
