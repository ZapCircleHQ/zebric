# @zebric/mcp-server

Expose a running Zebric application's Agent API as an MCP server over stdio. When the application advertises its authenticated Agent API event stream, the adapter also declares Claude Code's experimental `claude/channel` capability and forwards redacted entity and workflow notifications into the session.

```sh
zebric-mcp-server --connect http://127.0.0.1:3000
```

Bearer authentication can be supplied without placing a credential on the command line:

```sh
ZEBRIC_API_KEY=secret zebric-mcp-server --connect http://127.0.0.1:3000 --credential-env ZEBRIC_API_KEY
```

The server exposes reads by default. Mutations must be opted in by exact OpenAPI operation ID with repeatable `--allow-mutation` options. Zebric's existing HTTP authorization, validation, idempotency, workflow, and audit paths remain authoritative.
