# Zebric Dispatch Issues

This file tracks known issues for `examples/zebric-dispatch`. Add new issues as they are discovered.

## Execution Plan

Prioritize Zebric Core platform reliability first, then expand external integrations.

### P0 (Core Reliability)

- [ ] Stabilize workflow interpolation/coercion in notifications.
  - Outcome: no `[object Object]` or unresolved tokens in workflow-rendered text.
  - Scope: `packages/runtime-node` workflow resolver and notify execution path.
- [ ] Add end-to-end tests for inbound notification -> workflow trigger -> persistence.
  - Outcome: automated coverage of Slack inbound path and webhook-to-workflow dispatch.
  - Scope: `packages/runtime-node`, `packages/notifications`.
- [ ] Harden security baselines for machine-to-machine endpoints.
  - Outcome: consistent signed webhook verification patterns and explicit auth/CSRF behavior.
  - Scope: notification/webhook route middleware and adapter contracts.
- [ ] Improve workflow diagnostics in admin/debug surfaces.
  - Outcome: clear visibility into step input/output and failure context without ad hoc logging.
  - Scope: workflow manager/admin server observability.

### P1 (Core UX + Framework Correctness)

- [ ] Make entity-to-detail route resolution deterministic across multiple detail pages.
  - Outcome: first-column links always route to correct entity detail page.
  - Scope: renderer route lookup heuristics in `runtime-core`.
- [ ] Standardize inbound notification adapter contract.
  - Outcome: common schema for validated payload, ack behavior, and workflow handoff.
  - Scope: `packages/notifications` types + manager behavior.

### P2 (External Integrations and Product Features)

- [ ] Convert inbound Slack signals into normalized `Request` intake flow.
  - Outcome: Slack events create/attach actionable requests, not just raw signals.
  - Scope: `examples/zebric-dispatch` workflows + mapping rules.
- [ ] Add Linear/GitHub/Notion sync automations.
  - Outcome: bidirectional status + item sync with conflict-safe behavior.
  - Scope: integration workflows and adapters.
- [ ] Build AI-assisted triage features (dedupe, summaries, routing).
  - Outcome: reduced manual triage load and better prioritization throughput.
  - Scope: external model integrations + dispatch workflows.

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
