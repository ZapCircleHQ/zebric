# New employee access handoff demo

This is the V1 acceptance scenario: Human → Agent → Approval required → Human → Agent → Complete.

## Setup

```bash
export DISPATCH_AGENT_API_KEY='dispatch-local-demo-key'
pnpm --filter zebric-dispatch dev
pnpm --filter zebric-dispatch seed
```

Connect an MCP-compatible client using the normal Zebric MCP setup, the bearer key, and a stable per-run `X-Agent-Run-ID`, for example `new-hire-access-demo-1`.

## Scenario

1. Discover the `dispatch` capability and find `DSP-1042`, “Grant production log access.”
2. Inspect the Request, comments, approvals, and activity.
3. Add progress explaining the least-privilege role identified.
4. Observe `approvalState = pending`. Do not call protected-work or completion actions.
5. Sign in as `jeff@dispatch.local`. The Inbox shows the required decision.
6. Open the Request and click **Approve**. The Approval becomes approved and the Request moves to `in_progress`.
7. As the agent, inspect approval again, start approved work if needed, record what was provisioned, and complete the Request.
8. Refresh Request detail. The timeline distinguishes the agent investigation/completion from Jeff's approval.

## Expected governance evidence

- `start_approved_work` fails before approval.
- `complete_request` fails for protected work without `approvalState = approved`.
- The default agent credential has no approval-decision action.
- Mutations require bearer credentials, matching scopes, and `X-Agent-Run-ID`.
- Humans and agents share the same Request, Approval, Comment, and workflow state.

The remaining generic-CRUD mutation limitation is G-01 in `ZEBRIC_GAPS.md`.
