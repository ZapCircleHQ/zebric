# @zebric/mcp-server

## 0.7.0

### Minor Changes

- d8d5502: Add stateless MCP Streamable HTTP handlers for Node HTTP/S and Cloudflare Workers, with CLI transport selection, TLS, mandatory public authentication or explicit opt-in, and origin validation. Bound and validate request bodies before discovery, enforce concurrency and body-read deadlines, and cache/coalesce discovery. Preserve stdio and persistent Claude channels. Expose the agent runtime separately so Workers do not import Node authoring and CLI modules.

### Patch Changes

- 860f493: Use portable manual redirect handling with explicit redirect refusal, exclude SSE-only operations from finite JSON tools, and correct mutation descriptions. Preserve structured Agent API tool errors and support request-specific HTTP credentials and upstream fetch context while sharing discovery caching.
- Updated dependencies [d8d5502]
- Updated dependencies [860f493]
  - @zebric/agent@0.7.0

## 0.6.3

### Patch Changes

- @zebric/agent@0.6.3

## 0.6.2

### Patch Changes

- @zebric/agent@0.6.2

## 0.6.1

### Patch Changes

- @zebric/agent@0.6.1

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
