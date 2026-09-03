---
"@zebric/runtime-core": patch
"@zebric/runtime-node": patch
---

Add write-protected entity fields and enforce them end to end.

- The generated OpenAPI `Create` and `Update` request bodies now omit protected fields: the primary key, the runtime-managed timestamps (`id`, `createdAt`, `updatedAt`), and any field the blueprint denies with `access = { write = false }`. Protected fields stay in the read model, so an agent is never offered them and cannot pass them through a schema-validated Agent API or MCP tool call.
- `QueryExecutor` (runtime-node) now strips fields the caller may not write on both `create` and `update`/`updateWhere`, honouring blueprint field-level `access.write` rules (including the "cannot write what you cannot read" fallback). Trusted system / workflow sessions bypass the filter, matching how they already bypass entity-level access checks. An update whose fields are all stripped is a no-op that returns the current record rather than erroring.
