---
"@zebric/runtime-worker": patch
---

Enforce blueprint access control in the Workers (D1) query executor, which previously ran every `create`, `update`, and `delete` with no authorization at all. `WorkersQueryExecutor` now:

- checks the entity-level `access` rule for the action (`create` / `update` / `delete`) and throws `Access denied` when it fails, matching the Node and simulator executors;
- evaluates `update` access against the merged existing-plus-incoming record so ownership rules work;
- drops fields the caller may not write per field-level `access.write` rules, with trusted system / workflow sessions bypassing the filter;
- treats an update whose fields are all unwritable as a no-op returning the current row.

Read-path row-level filtering in this executor is still absent and tracked separately.
