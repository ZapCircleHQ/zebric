# Zebric Dispatch Issues

This file tracks known issues for `examples/zebric-dispatch`. Add new issues as they are discovered.

## 2026-02-13: Slack notification fields render as `[object Object]`

- Status: Open
- Area: Workflow notifications (`NotifyResolvedRequestToSlack`)
- Severity: Medium

### Summary
Slack notifications are successfully sent when a request is marked resolved, but `priority` and `source` can render as `[object Object]` in the message blocks instead of a readable scalar value.

### Reproduction
1. Start Zebric Dispatch and configure Slack bot token/channel.
2. Open a request detail page.
3. Trigger `Mark resolved`.
4. Inspect the Slack message in the target channel.

### Expected
`Priority` and `Source` show readable text values (for example, `High`, `Slack`).

### Actual
`Priority` and/or `Source` may render as `[object Object]` or unresolved template text depending on template path used.

### Notes
- End-to-end Slack plumbing is working:
  - workflow trigger works,
  - notification adapter sends successfully,
  - messages arrive in channel.
- The remaining gap is template interpolation/coercion for enum/object-shaped values in workflow notify payloads.

### Next Steps
- Add temporary debug logging of resolved notify payload in `WorkflowExecutor.executeNotify`.
- Capture the exact runtime shape of `trigger.after.priority` and `trigger.after.source` in the failing path.
- Normalize enum/object values at a single interpolation boundary and add targeted regression tests.
