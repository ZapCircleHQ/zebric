# Zebric CRM contributor guidance

This CRM is a governed system of record shared by humans and agents.

- Keep entities, authorization, lifecycle rules, and integrations in `blueprint.toml` when Zebric can express them.
- Expose semantic workflows to agents; never offer direct stage, approval, disposition, or insight-status mutation as a convenience.
- Outbound messages that require review must stop at `pending` until an authorized assistant or manager approves them.
- Keep Google Places candidates separate from authoritative Accounts and Leads until promotion.
- Preserve human initiator, agent executor, source, and external identifiers wherever the current framework makes them available.
- Do not add CRM-specific branches to framework packages. Document gaps in `ZEBRIC_GAPS.md`.
- Authorize scoped records through immutable `teamId` and stored active `TeamMembership` rows. Copied owner/email/agent fields are display metadata only. Validate every parent belongs to the same team.
- Keep outreach drafts and reviewer assignment immutable. Approval must come from an independent designated reviewer or manager, and applies to the exact stored content. Create a replacement draft to revise content.
