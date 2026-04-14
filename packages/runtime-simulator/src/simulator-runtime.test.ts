import { describe, expect, it } from 'vitest'
import { ZebricSimulatorRuntime } from './simulator-runtime.js'

const blueprintToml = `version = "0.2.0"

[project]
name = "Smoke"
version = "1.0.0"

[project.runtime]
min_version = "0.2.0"

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
    expect(runtime.getState().audit.some((entry) => entry.metadata?.eventType === 'workflow.trigger')).toBe(true)

    runtime.resetSeed()
    expect(runtime.getState().data.Task).toHaveLength(1)
  })
})
