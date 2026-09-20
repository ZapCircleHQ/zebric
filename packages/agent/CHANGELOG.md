# @zebric/agent

## 0.5.0

### Patch Changes

- Updated dependencies [b48d68b]
  - @zebric/runtime-core@0.5.0

## 0.4.0

### Minor Changes

- 48bcb96: Add the initial Zebric Agent package and typed query filtering for agent-facing skill collection actions.
- 4baefc7: Derive complete create and update tool inputs from explicitly published entity actions, resolve safe local OpenAPI component schemas, and expand the flagship Task Tracker MCP lifecycle.

### Patch Changes

- eb04979: Harden the MCP adapter against a hostile or compromised Zebric application. The event stream now refuses to follow redirects off the discovered origin, times out a stalled connection instead of blocking server startup, validates every server-sent event against a schema before forwarding it, and caps the bytes buffered between SSE record boundaries. Runtime tool responses are size-limited while streaming (rather than after buffering the whole body), and remote-supplied string `pattern` schemas are rejected when they are over-long or nest unbounded quantifiers that risk catastrophic backtracking.
- Updated dependencies [48bcb96]
- Updated dependencies [9aa29c3]
- Updated dependencies [e0da6cd]
- Updated dependencies [9200a34]
- Updated dependencies [1df1c9a]
- Updated dependencies [4baefc7]
  - @zebric/runtime-core@0.4.0
