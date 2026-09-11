---
"@zebric/runtime-worker": patch
---

Enforce blueprint access control in the Workers (D1) query executor, which previously ran every `create`, `update`, and `delete` with no authorization at all. `WorkersQueryExecutor` now:

- enforces role permissions and entity-level `access` rules for reads, searches, creates, updates, and deletes, matching the Node executor;
- applies row-level filters to collection reads and hides records that fail read access in `findById`;
- evaluates update and delete access against the stored record so caller-controlled fields cannot forge ownership;
- strips fields denied by field-level `access.read` from returned records;
- drops fields the caller may not write per field-level `access.write` rules, with trusted system / workflow sessions bypassing the filter;
- treats an update whose fields are all unwritable as a no-op returning the current row.
