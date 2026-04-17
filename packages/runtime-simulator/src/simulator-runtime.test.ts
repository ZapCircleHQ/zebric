import { describe, expect, it } from 'vitest'
import { ZebricSimulatorRuntime } from './simulator-runtime.js'

const blueprintToml = `version = "0.2.0"

[project]
name = "Smoke"
version = "1.0.0"

[project.runtime]
min_version = "0.2.0"

[notifications]
default = "slack_ops"

[[notifications.adapters]]
name = "slack_ops"
type = "slack"
[notifications.adapters.config]
defaultChannel = "#ops"

[[notifications.adapters]]
name = "email"
type = "email"
[notifications.adapters.config]
from = "noreply@example.test"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true }
]

[entity.Task.access]
read = true
create = true
update = true
delete = true

[page."/"]
title = "Tasks"
auth = "optional"
layout = "list"

[page."/".queries.tasks]
entity = "Task"

[page."/tasks/new"]
title = "New Task"
auth = "optional"
layout = "form"

[page."/tasks/new".form]
entity = "Task"
method = "create"
onSuccess = { redirect = "/" }

[[page."/tasks/new".form.fields]]
name = "title"
type = "text"
label = "Title"
required = true

[workflow.MarkDone]
trigger = { manual = true }

[[workflow.MarkDone.steps]]
type = "plugin"
plugin = "tasks"
action = "markDone"

[[workflow.MarkDone.steps]]
type = "notify"
adapter = "slack_ops"
channel = "#ops"
body = "Task {{ variables.id }} done"

[[workflow.MarkDone.steps]]
type = "email"
to = "manager@example.test"
subject = "Task {{ variables.id }} done"
body = "The task is done."

[[workflow.MarkDone.steps]]
type = "webhook"
url = "https://example.test/hooks/{{ variables.id }}"
method = "POST"
[workflow.MarkDone.steps.headers]
Content-Type = "application/json"
[workflow.MarkDone.steps.payload]
id = "{{ variables.id }}"

[workflow.HandleSlackApproval]
trigger = { webhook = "/notifications/slack_ops/actions" }

[[workflow.HandleSlackApproval.steps]]
type = "notify"
adapter = "slack_ops"
channel = "#ops"
body = "Slack {{ variables.webhook.body.action_id }} for {{ variables.webhook.body.value }} by {{ variables.webhook.body.user_id }}"
`

describe('ZebricSimulatorRuntime', () => {
  it('renders seeded data and handles create forms in memory', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml,
      seeds: {
        demo: {
          Task: [{ id: 'task-1', title: 'Existing task' }],
        },
      },
      initialSeed: 'demo',
      initialAccount: null,
    })

    const initial = await runtime.render('/')
    expect(initial.status).toBe(200)
    expect(initial.html).toContain('Existing task')
    expect(runtime.getState().audit[0]?.metadata?.eventType).toBe('DATA_READ')

    runtime.switchAccount('user')
    expect(runtime.getState().audit[0]?.metadata?.eventType).toBe('auth.login.success')
    expect(runtime.getState().audit[0]?.action).toBe('User logged in')
    expect(runtime.getState().audit[0]?.metadata?.nextUserId).toBe('user')

    await runtime.submit('/tasks/new', 'POST', { title: 'Created task' })
    const state = runtime.getState()
    expect(state.data.Task).toHaveLength(2)
    expect(state.data.Task?.[1]?.title).toBe('Created task')
    expect(runtime.getState().audit.some((entry) => entry.metadata?.eventType === 'data.create')).toBe(true)

    await runtime.triggerWorkflow('MarkDone', { id: 'task-1' })
    expect(runtime.getState().registeredWorkflows[0]?.name).toBe('MarkDone')
    expect(runtime.getState().workflows[0]?.workflowName).toBe('MarkDone')
    expect(runtime.getState().integrations.map((entry) => entry.kind)).toEqual(['slack', 'email', 'webhook'])
    expect(runtime.getState().integrations.find((entry) => entry.kind === 'slack')?.body).toBe('Task task-1 done')
    expect(runtime.getState().integrations.find((entry) => entry.kind === 'email')?.subject).toBe('Task task-1 done')
    expect(runtime.getState().integrations.find((entry) => entry.kind === 'webhook')?.url).toBe('https://example.test/hooks/task-1')
    expect(runtime.getState().audit.some((entry) => entry.metadata?.eventType === 'workflow.trigger')).toBe(true)

    const webhookResult = runtime.triggerWebhook('/notifications/slack_ops/actions', {
      action_id: 'dispatch_approve',
      value: 'task-1',
      user_id: 'U123',
    }, {
      'x-slack-signature': 'v0=simulated',
    })
    expect(webhookResult.status).toBe(200)
    expect(webhookResult.matchedWorkflows).toEqual(['HandleSlackApproval'])
    expect(runtime.getState().integrations[0]?.body).toBe('Slack dispatch_approve for task-1 by U123')
    expect(runtime.getState().audit[0]?.metadata?.eventType).toBe('workflow.webhook')

    runtime.resetSeed()
    expect(runtime.getState().data.Task).toHaveLength(1)
  })
})
