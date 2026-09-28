# CRM architecture retrospective

## Shape

```text
Google Places          SendGrid inbound          OpenAI classification
      |                       |                         |
      v                       v                         v
external workflow      authenticated webhook      structured suggestion
      |                       |                         |
      v                       v                         v
ProspectCandidate       Message + Activity  -> ApplyReplyClassification
      |                                               |
      v                                               v
semantic promotion         Zebric entities + deterministic workflows
                                  |
                         +--------+--------+
                         |                 |
                      Web UI           CRM MCP skill
```

Zebric is the state and policy boundary. Google, SendGrid, and the LLM return
inputs; they do not own CRM lifecycle state. Agent and human commands converge on
the same workflow definitions.

## What belongs naturally in Zebric

The relational model, enums, references, row access, forms and queries, agent
surface, workflow preconditions, compare-and-set transitions, approval stop,
outbound HTTP calls, webhook entry, activity projection, and deterministic task
creation all fit in the blueprint. This is the majority of domain behavior.

The most successful pattern is the same one used by Dispatch: important mutations
have named commands. The same workflow handles validation and side effects whether
called from UI, HTTP, or MCP. The same pattern also keeps the LLM subordinate to a
small classification schema.

## What does not fit cleanly

- Team authorization needs relation-aware row rules. The current implementation
  denormalizes `ownerId` and one `assistantEmail` onto every team-scoped record.
- An agent credential cannot carry the initiating human's authorization context.
- External responses need typed transforms: Places result counts/deduplication and
  parsing an LLM's JSON content cannot be expressed robustly.
- SendGrid Inbound Parse needs a multipart/signature normalization adapter.
- A real Google Maps browser widget needs safe client-side key/config binding.
- Bulk semantic commands, saved views, CSV import/export, and server-side table
  filtering are not exposed as composable blueprint primitives.
- Workflow writes and direct CRUD writes share entity update permission.

Those are framework-shaped needs, not reasons to build a separate CRM backend.

## Approximate implementation split

The application intentionally contains no framework modifications and no
application TypeScript/JavaScript service.

| Area | Approximate share | Location |
|---|---:|---|
| Declarative entities, access, UI queries/forms, skills, auth | 55% | `blueprint.toml` |
| Declarative workflows/integration calls | 25% | `blueprint.toml` |
| Custom Liquid/CSS/browser enhancement | 10% | `templates/` |
| Demo/provisioning shell | 7% | `seed.sh` |
| Integration adapter required for production | 3% (documented, not implemented) | deployment edge |
| Framework modifications | 0% | none |

The browser JavaScript is presentation-only: local table filters, selection, and
the contained coordinate plot. It owns no business invariant. The unimplemented
edge adapter is deliberately narrow and has no authoritative application state.

## Evaluation

Zebric can express a credible CRM's system-of-record core and agent command
surface compactly. It is strongest where the problem is relational state plus
guarded transitions. Its current boundary appears at identity delegation,
relation-aware authorization, external-data transformation, and data-heavy UI
composition. Solving those generically would benefit Dispatch, Ridgeline, and
other applications; none requires a CRM-specific runtime branch.

