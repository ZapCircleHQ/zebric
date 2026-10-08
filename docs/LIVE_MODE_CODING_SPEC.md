# Zebric Live Mode — Coding Specification

**Status:** Proposed  
**Initial target:** Zebric runtime-core, runtime-node, runtime-worker  
**Implementation scope:** Phase 1 only  
**Motivation:** Cloudflare Artifacts / software-factory example

## 1. Summary

Zebric Live Mode allows a rendered page to remain synchronized with application data while the page is open.

A Blueprint author opts a page into Live Mode declaratively:

```toml
[page.TaskBoard]
live = true
```

When data relevant to the page changes, Zebric notifies the browser and refreshes the rendered view.

The initial use case is intentionally narrow:

> A human is watching a Zebric board, queue, dashboard, or detail page while humans, agents, commands, workflows, or integrations modify the underlying application state.

Live Mode must work consistently across the Node and Cloudflare Workers runtimes.

The initial implementation is **unidirectional: server to browser**.

The architecture must leave room for future event delivery, MCP Events, presence, multiplayer applications, and collaborative state, but none of those capabilities are part of the initial implementation.

---

# 2. Goals

Phase 1 must:

- Support `live = true` on Blueprint pages.
- Work on both Node and Cloudflare Workers.
- Detect mutations performed through normal Zebric mutation paths.
- Notify open browsers when data relevant to their page may have changed.
- Refresh server-rendered page content.
- Preserve reasonable browser state during refresh.
- Avoid overwriting actively edited forms.
- Recover from temporary connection failures.
- Respect normal Zebric authentication and authorization.
- Require no additional infrastructure for a basic Zebric deployment.
- Establish runtime-independent abstractions for future live/event capabilities.

Live Mode should work regardless of whether a mutation originated from:

- UI CRUD
- HTTP API
- MCP
- Commands
- Workflows
- Agents using any of the above

The mechanism by which a mutation occurred should not matter to the browser.

---

# 3. Non-goals

Phase 1 does **not** implement:

- Multiplayer editing
- Presence
- Cursor synchronization
- Collaborative text editing
- CRDTs or Operational Transformation
- Browser-to-browser messaging
- Client-originated Live Session events
- WebSockets
- WebTransport
- MCP Events
- External webhooks
- Declarative domain events
- Event-triggered workflows
- Durable external event delivery
- Exactly-once event delivery
- Distributed pub/sub infrastructure
- Durable Objects
- Cloudflare Queues
- Redis
- Kafka
- Region-level DOM synchronization
- Fine-grained DOM diffing
- Query-aware invalidation
- Record-aware invalidation

These may build on Live Mode infrastructure later.

Do not implement them as part of this work.

---

# 4. Architectural principles

## 4.1 Blueprint semantics are transport-independent

This:

```toml
live = true
```

means:

> Keep this rendered page synchronized with relevant application state.

It does **not** mean:

> Open an SSE connection.

SSE, polling, WebSockets, and future transports are implementation details.

---

## 4.2 Same semantics across runtimes

A Blueprint using:

```toml
live = true
```

must behave equivalently under Node and Cloudflare Workers.

Runtime-specific optimizations are allowed.

Runtime-specific Blueprint semantics are not.

---

## 4.3 Server remains authoritative

Live Mode does not introduce client-side application state as an alternative source of truth.

The server:

1. owns application state;
2. evaluates authorization;
3. executes queries;
4. renders the view.

The browser receives notification that its projection may be stale and obtains an updated server-rendered projection.

---

## 4.4 Events invalidate; queries determine state

A change event does not need to describe the new UI.

Its primary purpose is:

> Something changed that may make this projection stale.

The browser then obtains current state through the normal Zebric renderer.

This keeps event delivery independent from page rendering.

---

## 4.5 Live delivery is downstream of successful mutation

Live notification must not participate in the business transaction.

Conceptually:

```text
Mutation
    |
    v
Authorization
    |
    v
Database Transaction
    |
    v
Commit
    |
    v
Change Event
    |
    v
Live Invalidation
```

A broken browser connection must never cause a command, workflow, or mutation to fail.

Events must not represent rolled-back mutations.

---

# 5. Conceptual architecture

```text
                Blueprint
                live = true
                     |
                     v
              Page Renderer
                     |
                     v
               Live Session
                     |
                     v
             Page Dependencies
                     |
                     v
                 Cursor
                     |
                     v
               Live Runtime
                     |
          +----------+----------+
          |                     |
          v                     v
       Node                  Workers
          |                     |
          +----------+----------+
                     |
                     v
               Live Transport
                     |
          +----------+----------+
          |                     |
         SSE                  Poll
          |                     |
          +----------+----------+
                     |
                     v
                  Browser
                     |
                     v
              Server Re-render
```

The runtime implementation may differ internally, but these concepts should not depend on Cloudflare Workers.

---

# 6. Change events

Phase 1 should establish a small internal change-event contract.

For example:

```ts
interface ZebricChangeEvent {
  id: string;
  entity: string;
  recordId?: string;
  operation: "create" | "update" | "delete";
  cursor: string;
  timestamp: string;
}
```

The exact TypeScript representation may differ based on existing Zebric conventions.

Requirements:

- Every event has a stable unique ID.
- Every event can participate in ordered reconciliation through a cursor.
- Events occur only after successful mutation.
- Events identify at least the affected entity.
- Events are runtime-independent.

Do not attempt to model business semantics in Phase 1.

For example:

```text
Task updated
```

is sufficient.

Do not introduce:

```text
task.completed
initiative.approved
proposal.submitted
```

as part of this implementation.

Those are future domain events.

---

# 7. Audit journal relationship

The existing Workers prototype watches the audit journal.

That approach may continue to be used where useful, but Live Mode must not be architecturally defined as:

> Poll the audit journal once per second.

The journal may provide:

- durable mutation observation;
- cursors;
- restart recovery;
- reconciliation after disconnect.

Prefer reusing existing durable Zebric mutation/audit infrastructure rather than introducing a second persistence system solely for Live Mode.

However, keep these concepts logically distinct:

```text
Audit Record
    !=
Change Event
    !=
Future Domain Event
```

An audit record may contain information that should never be exposed to a browser or external event consumer.

---

# 8. Live Session

Introduce an internal runtime concept representing an active live view.

Conceptually:

```ts
interface LiveSession {
  page: string;
  path: string;
  actor: Actor;
  dependencies: LiveDependency[];
  cursor?: string;
}
```

This does not need to become a persistent database entity.

For Phase 1, the only required capability is:

```text
invalidate
```

Future implementations may extend the conceptual model with:

```text
presence
client-events
shared-state
```

Do not implement those capabilities now.

The important requirement is that the abstraction must not assume Live Mode will always be unidirectional.

---

# 9. Dependency discovery

When rendering a live page, Zebric must determine which entities can affect that page.

For Phase 1, use **entity-level dependency tracking**.

Example:

```text
TaskBoard
  queries Task
  queries Project
  queries User

dependencies = [Task, Project, User]
```

A mutation to any of those entities may invalidate the page.

This intentionally permits false positives.

Correctness is more important than minimizing refreshes.

Do not implement:

- query-level invalidation;
- predicate evaluation;
- record-level invalidation;
- dependency graph optimization.

Those belong to later phases.

The renderer/compiler should expose dependency discovery in a way that can become more precise later without changing Blueprint syntax.

---

# 10. Transport

## 10.1 Required transports

Phase 1 supports:

1. Server-Sent Events
2. HTTP polling fallback

Both Node and Workers must support both semantics.

SSE should normally be preferred when available.

Polling provides the universal fallback.

---

## 10.2 Transport abstraction

The core Live Mode implementation must not depend directly on SSE APIs.

Use a runtime abstraction conceptually similar to:

```ts
interface LiveTransport {
  subscribe(session: LiveSession): LiveSubscription;
}

interface LiveSubscription {
  close(): void;
}
```

The exact API should follow existing Zebric runtime conventions.

The abstraction should permit future bidirectional transports without requiring the Live Session model to be replaced.

Do not implement the future bidirectional API now.

---

# 11. Live endpoint

Both runtimes should expose equivalent Live Mode behavior.

The current prototype uses:

```text
/_zebric/live?path=...
```

That route may be retained if appropriate.

The endpoint must:

1. authenticate the actor;
2. resolve the requested Zebric page;
3. verify that the page has Live Mode enabled;
4. determine its entity dependencies;
5. verify that the actor may read the page/dependencies;
6. establish a cursor;
7. notify the browser when the page may have become stale.

Do not expose raw audit records through this endpoint.

Notifications should be minimal.

For example:

```json
{
  "type": "invalidate",
  "cursor": "1842"
}
```

Entity names do not need to be exposed to the browser.

---

# 12. Render-to-subscribe race

Phase 1 must explicitly handle this race:

```text
Browser requests page
        |
        v
Server renders page
        |
        |   <-- mutation happens here
        |
        v
Browser establishes live connection
```

The browser must not remain permanently stale because a mutation occurred between render and subscription.

The initial render should therefore establish or expose a cursor/version that Live Mode can reconcile when connecting.

Equivalent mechanisms are acceptable, but this race must have an integration test.

---

# 13. Browser behavior

When a live page loads:

1. normal SSR content renders first;
2. the Live client initializes;
3. it establishes an SSE subscription;
4. it reconciles against the render cursor;
5. it waits for invalidation.

On invalidation:

1. debounce rapid notifications;
2. mark the view as updating;
3. fetch a fresh server-rendered projection;
4. replace the appropriate Phase 1 page content;
5. re-run Zebric enhancement behavior;
6. restore appropriate browser state;
7. update the cursor;
8. return to Live state.

---

# 14. Browser state preservation

Phase 1 uses page/main-content replacement rather than fine-grained DOM patches.

Preserve where practical:

- scroll position;
- focused element;
- selection where feasible;
- normal enhanced-form behavior.

Most importantly, Live Mode must not overwrite unsaved user edits.

The existing prototype delays replacement while a form field has focus.

Phase 1 should strengthen this to track **dirty form state**, rather than focus alone.

If the page has dirty user input:

```text
Server invalidation
       |
       v
Mark refresh pending
       |
       X
Do not replace edited content
```

Once the dirty state is resolved, the pending invalidation can be reconciled.

Do not build conflict-resolution UI in Phase 1.

---

# 15. Status indicator

A live page should expose unobtrusive connection state.

Minimum states:

```text
Live
Updating
Reconnecting
```

The indicator should not dominate the application UI.

If Live Mode permanently falls back to polling, the application may continue to display `Live`; transport details are not generally meaningful to users.

---

# 16. Reconnection and consistency

Live Mode guarantees **eventual view synchronization**, not exactly-once event delivery.

The system must tolerate:

- duplicated invalidations;
- lost connections;
- browser sleep;
- tab suspension;
- server restart;
- transport reconnection.

After reconnecting, the client must determine whether anything changed after its last cursor.

If so, refresh.

Duplicate invalidations must be harmless.

Older refresh responses must not overwrite newer rendered content.

---

# 17. Authorization

Live Mode must preserve normal Zebric authorization boundaries.

The live connection must:

- require normal authentication where the page requires authentication;
- evaluate page access;
- respect entity/query read permissions;
- terminate or fail safely if authorization disappears.

Notifications should not contain record data.

The refreshed projection must go through the normal authorized rendering path.

Live Mode must never become an alternate data-access mechanism.

---

# 18. Direct database writes

Phase 1 only guarantees detection for mutations that pass through supported Zebric mutation paths.

Direct SQL/database writes may not produce Live Mode notifications.

Document this limitation.

Do not introduce database triggers or external change-data-capture infrastructure as part of Phase 1.

---

# 19. Runtime requirements

## Node

The Node implementation may use:

- in-process signaling for fast notification;
- the existing journal for reconciliation;
- SSE;
- HTTP polling.

Correctness must survive a Node process restart through reconciliation against durable state where available.

Do not add Redis or another distributed dependency.

Multi-instance optimization is not part of Phase 1.

---

## Cloudflare Workers

The Workers implementation may use:

- the existing journal;
- SSE;
- HTTP polling;
- existing Zebric storage/runtime capabilities.

Do not require:

- Durable Objects;
- Cloudflare Queues;
- new bindings solely for Live Mode.

The implementation should remain suitable for small Zebric applications with minimal deployment configuration.

---

# 20. Tests

At minimum, integration coverage should include:

| Scenario | Node | Workers |
|---|---:|---:|
| `live = true` recognized | ✓ | ✓ |
| Non-live page unchanged | ✓ | ✓ |
| UI mutation invalidates page | ✓ | ✓ |
| MCP mutation invalidates page | ✓ | ✓ |
| Command mutation invalidates page | ✓ | ✓ |
| Workflow mutation invalidates page | ✓ | ✓ |
| Relevant entity mutation refreshes page | ✓ | ✓ |
| Unrelated entity does not refresh page | ✓ | ✓ |
| Multiple rapid mutations debounce | ✓ | ✓ |
| Disconnect/reconnect catches up | ✓ | ✓ |
| Duplicate invalidation harmless | ✓ | ✓ |
| Render-to-subscribe race | ✓ | ✓ |
| Dirty form prevents replacement | ✓ | ✓ |
| Unauthorized subscription rejected | ✓ | ✓ |
| Refreshed content respects authorization | ✓ | ✓ |

Also retain/add renderer tests covering re-enhancement after content replacement.

---

# 21. Documentation

Add user-facing Live Mode documentation covering:

```toml
[page.TaskBoard]
live = true
```

Explain:

- what Live Mode does;
- Node and Workers support;
- that updates are server-driven;
- supported mutation sources;
- browser behavior;
- direct SQL limitation;
- current page-level refresh granularity.

Do not document transport details as part of the Blueprint contract except where useful for deployment troubleshooting.

---

# 22. Phase 1 — Live Pages

**Implement now.**

Phase 1 consists of:

- `live = true`
- runtime-core Live abstractions
- Node support
- Workers support
- committed change events
- entity dependency discovery
- cursor/reconciliation mechanism
- SSE
- polling fallback
- page/main-content refresh
- debounce
- reconnection
- dirty-form protection
- status indicator
- authorization
- integration tests
- documentation

This is the complete scope required for the Artifacts project.

**Stop after Phase 1.**

The following phases are architectural direction, not authorization to implement additional functionality.

---

# 23. Phase 2 — Efficient Live Views

**Future. Do not implement now.**

Potential capabilities:

- region-level invalidation;
- keyed render regions;
- DOM morphing/patching;
- more precise dependency tracking;
- query-aware invalidation;
- record-aware invalidation;
- connection multiplexing;
- multi-instance notification optimization.

Example future conceptual model:

```text
Page
 ├── Board       <- Task
 ├── Activity    <- Activity
 └── Metrics     <- Task, Project
```

A Task mutation could refresh only the affected regions.

Blueprint compatibility requirement:

```toml
live = true
```

must continue to work unchanged.

---

# 24. Phase 3 — Domain Events and External Consumers

**Future. Do not implement now.**

Introduce first-class semantic application events such as:

```text
task.completed
initiative.approved
proposal.submitted
```

Potential consumers include:

- MCP Events;
- external webhooks;
- internal workflow triggers;
- integrations.

Architecture:

```text
Domain Mutation
      |
      v
 Durable Event
      |
      v
 Event Router
   /    |     \
Live   MCP   Workflow
```

Requirements will likely include:

- event schemas;
- declarative event definitions;
- subscription persistence;
- signed delivery;
- retry policy;
- causation IDs;
- correlation IDs;
- loop prevention;
- delivery idempotency.

MCP Events should eventually be implemented as an adapter over Zebric event infrastructure rather than as a separate event system.

Do not build this infrastructure in Phase 1 beyond maintaining architectural compatibility.

---

# 25. Phase 4 — Interactive Live Sessions

**Future. Do not implement now.**

Extend Live Sessions from server-to-browser invalidation to bidirectional communication.

Potential capabilities:

- WebSockets;
- client-originated events;
- presence;
- user/agent activity;
- selections;
- cursors;
- ephemeral shared state.

Persistent application state and ephemeral session state must remain separate.

```text
                    Live Session
                         |
              +----------+----------+
              |                     |
              v                     v
      Persistent State       Ephemeral State
              |                     |
       Entity/Command             Presence
        /Workflow             Cursor/Selection
              |                     |
              v                     v
          Database             Live Runtime
```

Presence events must not automatically become durable entity mutations or audit records.

---

# 26. Phase 5 — Collaborative Applications

**Future research. Do not implement now.**

Potentially support Google Docs/Figma-style simultaneous editing.

Possible future technologies include:

- CRDTs;
- Operational Transformation;
- collaborative document libraries;
- specialized shared-state adapters.

Zebric should not invent a CRDT implementation as part of Live Mode.

A future collaborative field might conceptually resemble:

```toml
[field.Document.body]
type = "richtext"
collaboration = "realtime"
```

Collaborative draft state should remain distinct from governed domain transitions.

For example:

```text
Human ─┐
Human ─┼──> Collaborative Proposal
Agent ─┘             |
                     v
          SubmitInitiativeProposal
                     |
                     v
             Governed Domain State
```

This preserves Zebric's command and authorization model even inside multiplayer applications.

---

# 27. Future-proofing requirements

Although only Phase 1 is being implemented, its architecture MUST preserve the following possibilities.

### Transport evolution

```text
Today:
Live Session -> SSE / Poll

Future:
Live Session -> SSE / Poll / WebSocket / other transport
```

Do not make SSE synonymous with Live Mode.

### Event evolution

```text
Today:
Entity mutation -> invalidation

Future:
Entity mutation
Domain event
Workflow event
Presence event
```

Do not make audit records synonymous with events.

### Session evolution

```text
Today:
server -> browser

Future:
server <-> browser
```

Do not encode unidirectionality into the fundamental Live Session model.

### State evolution

Keep distinct:

```text
Persistent Domain State
Durable Domain Events
Ephemeral Session State
Collaborative State
```

Do not collapse these concepts into a single event or storage abstraction.

---

# 28. Design boundary

The primary design rule for Phase 1 is:

> Build only what is required for one-way server-to-browser Live Mode, but choose abstractions that do not prevent future event-driven automation or multiplayer applications.

Specifically:

> Live Mode v1 is unidirectional, but the Live Session model MUST NOT assume that Zebric live applications are permanently unidirectional.

And:

> Zebric MUST have a runtime-independent model for committed application changes. Delivery mechanisms such as SSE, polling, future MCP Events, and future multiplayer transports are consumers or adapters of that model rather than the model itself.

---

# 29. Definition of done

Phase 1 is complete when an example Blueprint can declare:

```toml
[page.TaskBoard]
live = true
```

and the following works under both Node and Workers:

```text
Human opens Task Board
        |
        v
Agent claims Task through MCP
        |
        v
Zebric commits mutation
        |
        v
Live infrastructure observes change
        |
        v
Browser receives invalidation
        |
        v
Task Board re-renders
        |
        v
Human sees agent claim without refreshing
```

The same must work for mutations caused by commands and workflows.

No WebSockets, multiplayer, MCP Events, domain-event framework, distributed pub/sub, or collaborative editing should be necessary to declare Phase 1 complete.

**Once these requirements are satisfied, stop.**