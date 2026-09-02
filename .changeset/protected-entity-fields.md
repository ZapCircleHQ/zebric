---
"@zebric/runtime-core": patch
---

Omit write-protected entity fields from the generated `Create` and `Update` request-body schemas. A field is protected when it is the primary key, a runtime-managed timestamp (`id`, `createdAt`, `updatedAt`), or the blueprint denies writes with `access = { write = false }`. Protected fields stay in the read model but an agent is no longer offered them and cannot set them through a schema-validated Agent API or MCP tool call.
