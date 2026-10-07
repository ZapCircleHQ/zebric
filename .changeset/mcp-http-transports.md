---
"@zebric/mcp-server": minor
"@zebric/agent": patch
---

Add stateless MCP Streamable HTTP handlers for Node HTTP/S and Cloudflare Workers, with CLI transport selection, TLS, mandatory public authentication or explicit opt-in, and origin validation. Bound and validate request bodies before discovery, enforce concurrency and body-read deadlines, and cache/coalesce discovery. Preserve stdio and persistent Claude channels. Expose the agent runtime separately so Workers do not import Node authoring and CLI modules.
