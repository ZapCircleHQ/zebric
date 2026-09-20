# @zebric/mcp-server

## 0.5.0

### Patch Changes

- @zebric/agent@0.5.0

## 0.4.0

### Minor Changes

- da59d64: Add the initial stdio MCP server adapter, generated Zebric tools, and official-client release gate.
- 4baefc7: Derive complete create and update tool inputs from explicitly published entity actions, resolve safe local OpenAPI component schemas, and expand the flagship Task Tracker MCP lifecycle.

### Patch Changes

- eb04979: Harden the MCP adapter against a hostile or compromised Zebric application. The event stream now refuses to follow redirects off the discovered origin, times out a stalled connection instead of blocking server startup, validates every server-sent event against a schema before forwarding it, and caps the bytes buffered between SSE record boundaries. Runtime tool responses are size-limited while streaming (rather than after buffering the whole body), and remote-supplied string `pattern` schemas are rejected when they are over-long or nest unbounded quantifiers that risk catastrophic backtracking.
- Updated dependencies [48bcb96]
- Updated dependencies [eb04979]
- Updated dependencies [4baefc7]
  - @zebric/agent@0.4.0
