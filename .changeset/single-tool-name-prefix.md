---
"@zebric/agent": minor
"@zebric/mcp-server": minor
---

Stop repeating the application prefix in generated tool names. When an operation ID already starts with the application name (for example, a skill named after its application), the tool is named after the operation ID alone: `task_tracker_list_tasks` instead of `task_tracker_task_tracker_list_tasks`. Other tool names are unchanged. MCP clients or agent configurations that reference the old doubled names must be updated; mutation allowlists use operation IDs and are unaffected.
