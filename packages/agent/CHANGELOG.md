# @zebric/agent

## 0.8.0

### Patch Changes

- Updated dependencies [c53fff4]
  - @zebric/runtime-core@0.8.0
  - @zebric/runtime-node@0.8.0

## 0.7.0

### Patch Changes

- d8d5502: Add stateless MCP Streamable HTTP handlers for Node HTTP/S and Cloudflare Workers, with CLI transport selection, TLS, mandatory public authentication or explicit opt-in, and origin validation. Bound and validate request bodies before discovery, enforce concurrency and body-read deadlines, and cache/coalesce discovery. Preserve stdio and persistent Claude channels. Expose the agent runtime separately so Workers do not import Node authoring and CLI modules.
- 860f493: Use portable manual redirect handling with explicit redirect refusal, exclude SSE-only operations from finite JSON tools, and correct mutation descriptions. Preserve structured Agent API tool errors and support request-specific HTTP credentials and upstream fetch context while sharing discovery caching.
- Updated dependencies [d946f63]
- Updated dependencies [adb3f8e]
- Updated dependencies [2ceb83f]
  - @zebric/runtime-node@0.7.0
  - @zebric/runtime-core@0.7.0

## 0.6.3

### Patch Changes

- Updated dependencies [25fabeb]
  - @zebric/runtime-core@0.6.3
  - @zebric/runtime-node@0.6.3

## 0.6.2

### Patch Changes

- Updated dependencies [c9b9e20]
  - @zebric/runtime-node@0.6.2
  - @zebric/runtime-core@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [2269b4c]
  - @zebric/runtime-node@0.6.1
  - @zebric/runtime-core@0.6.1

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
