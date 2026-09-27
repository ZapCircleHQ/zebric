# Dispatch development

## Local loop

1. Start the engine with `pnpm --filter zebric-dispatch dev`.
2. Seed once with `pnpm --filter zebric-dispatch seed`.
3. Validate with `pnpm --filter zebric-dispatch validate`.
4. Run the Dispatch framework story and, with a server running, `pnpm --filter zebric-dispatch test:workflows`.

The default SQLite database is `data/app.db`. Remove it only when intentionally starting a clean demo; the seed exits when the built-in categories exist.

## Design boundary

Keep domain state and rules in `blueprint.toml`. Custom Liquid is appropriate for Inbox, Requests, Request detail, and sign-in because they are product-defining. Category administration intentionally uses standard Zebric layouts. Do not add a parallel server, client framework, Dispatch-specific MCP server, or chatbot.

When a requirement cannot be expressed cleanly, update `ZEBRIC_GAPS.md` with desired behavior, relevant capability, observed limitation, workaround, and a framework-level acceptance test.
