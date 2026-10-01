# Domain commands in Zebric 0.6

CRUD remains available for ordinary data entry. Use a domain command when a
mutation represents a business decision or lifecycle transition that must have
the same rules in generated UI, HTTP, MCP, agents, and workflows.

```toml
[entity.Request]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "status", type = "Enum", values = ["pending", "approved"], default = "pending", write = "command-only", commands = ["ApproveRequest"] }
]

[command.ApproveRequest]
entity = "Request"
label = "Approve"
policy = "actor.roles contains 'approver' && record.requestedFromId == actor.effectiveId"
availableWhen = "record.status == 'pending'"
confirm = "Approve this request?"
mutations = { status = "approved", approvedById = "actor.effectiveId", approvedAt = "now" }
scopes = ["requests.approve"]
```

`policy` answers whether the actor may execute the operation. `availableWhen`
answers whether it is valid in the record's current state and controls generated
actions. Both are checked again during execution. Expressions may inspect
`actor`, `record`, `input`, `workflow`, and `now`; declared relations referenced
through `record` are loaded for policy evaluation.

`write = "command-only"` rejects generic create/update attempts that supply the
field. The optional `commands` list limits which commands may write it. Runtime
defaults remain usable when callers omit the protected field.

Commands accept typed input and can copy `input.*`, `actor.*`, and `record.*`
values into mutations. Use a registered TypeScript handler for logic that does
not fit declarative mutations; handlers receive actor-scoped database access,
typed services, audit, and event ports.

Workflows orchestrate commands rather than bypassing them:

```toml
[[workflow.ApproveAndNotify.steps]]
type = "command"
command = "ApproveRequest"
recordId = "{{ variables.data.record.id }}"
```

Transactional workflows may contain command steps. Database mutations join the
active transaction; external service/webhook effects must remain outside a
transactional workflow.

## Actors and API keys

Policies use one actor shape for humans, agents, services, and system work. API
keys can declare application roles in addition to scopes:

```toml
[[auth.apiKeys]]
name = "dispatch-agent"
keyEnv = "DISPATCH_AGENT_API_KEY"
agentId = "dispatch-agent"
roles = ["operator"]
scopes = ["dispatch.requests.read", "dispatch.requests.transition"]
```

Roles grant application permissions; scopes narrow the credential's transport
surface. A delegated actor keeps the agent identity in `actor.id` and the trusted
human identity in `actor.delegatedBy`/`actor.effectiveId`. Applications must bind
delegation in a trusted host or identity provider—never accept an arbitrary
caller-provided user identifier.

## Migration guidance

1. Identify lifecycle fields and semantic workflow operations.
2. Define commands with policy and state availability.
3. Mark protected fields command-only and list allowed commands.
4. Replace workflow query updates of those fields with command steps.
5. Give API-key principals explicit roles and retain least-privilege scopes.
6. Test both the allowed command and a rejected generic CRUD bypass.

The five stress-test applications under `examples/` contain complete 0.6
migrations. Their remaining limitations are tracked in each `ZEBRIC_GAPS.md`.
