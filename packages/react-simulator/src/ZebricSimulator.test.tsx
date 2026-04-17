// @vitest-environment happy-dom

import React, { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { ZebricSimulator } from './ZebricSimulator.js'
import type { SimulatorSeeds } from '@zebric/runtime-simulator'

const blueprintToml = `version = "0.2.0"

[project]
name = "Simulator Test"
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

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "status", type = "Enum", values = ["todo", "done"], default = "todo" }
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
body = "Workflow {{ variables.source }} done"

[[workflow.MarkDone.steps]]
type = "webhook"
url = "https://example.test/hooks/{{ variables.source }}"
method = "POST"

[workflow.HandleSlackAction]
trigger = { webhook = "/notifications/slack_ops/actions" }

[[workflow.HandleSlackAction.steps]]
type = "notify"
adapter = "slack_ops"
channel = "#ops"
body = "Slack {{ variables.webhook.body.action_id }} for {{ variables.webhook.body.value }}"
`

const seeds: SimulatorSeeds = {
  demo: {
    Task: [{ id: 'task-1', title: 'Existing task', status: 'todo' }],
  },
}

let roots: Root[] = []
let containers: HTMLElement[] = []

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  for (const container of containers) {
    container.remove()
  }
  roots = []
  containers = []
})

describe('ZebricSimulator', () => {
  it('renders preview and navigates with the page selector', async () => {
    const container = renderSimulator()
    await waitForText(container, 'Existing task')

    const pageSelect = getSelect(container, 'Page')
    expect(pageSelect.value).toBe('/')

    await changeSelect(pageSelect, '/tasks/new')
    await waitForText(container, 'New Task')
    expect(container.textContent).toContain('Route/tasks/new')
  })

  it('switches accounts and updates the Auth panel', async () => {
    const container = renderSimulator()
    await waitForText(container, 'Existing task')

    await changeSelect(getSelect(container, 'Account'), 'user')
    await clickButton(container, 'Auth')

    await waitForText(container, 'user@example.test')
    expect(container.textContent).toContain('User (user)')

    await clickButton(container, 'Audit')
    await waitForText(container, 'auth.login.success')
    await waitForText(container, 'User logged in')
  })

  it('submits form data and resets the active seed', async () => {
    const container = renderSimulator()
    await waitForText(container, 'Existing task')
    await changeSelect(getSelect(container, 'Page'), '/tasks/new')
    await waitForText(container, 'New Task')

    const titleInput = container.querySelector<HTMLInputElement>('input[name="title"]')
    expect(titleInput).toBeTruthy()
    await act(async () => {
      titleInput!.value = 'Created task'
      titleInput!.dispatchEvent(new Event('input', { bubbles: true }))
      titleInput!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await waitForText(container, 'Created task')
    await clickButton(container, 'Data')
    await waitForText(container, 'Created task')

    await clickButton(container, 'Reset seed')
    await waitForText(container, 'Existing task')
    expect(container.textContent).not.toContain('Created task')
  })

  it('triggers workflows and shows trigger history', async () => {
    const container = renderSimulator()
    await waitForText(container, 'Existing task')
    await clickButton(container, 'Workflows')
    await waitForText(container, 'MarkDone')

    await clickButton(container, 'Trigger')
    await waitForText(container, 'MarkDone debug')
    await clickButton(container, 'Integrations')
    await waitForText(container, 'Slack notification simulated via slack_ops')
    await waitForText(container, 'Webhook simulated: POST https://example.test/hooks/react-simulator')
    await clickButton(container, 'Dispatch webhook')
    await waitForText(container, 'Slack dispatch_approve for task-1')
    await clickButton(container, 'Audit')
    await waitForText(container, 'workflow.webhook')
    await waitForText(container, 'workflow.trigger')
    await waitForText(container, 'Trigger workflow: MarkDone')
  })
})

function renderSimulator(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ZebricSimulator
        blueprintToml={blueprintToml}
        seeds={seeds}
        initialSeed="demo"
        initialAccount="manager"
        parseDebounceMs={0}
      />
    )
  })
  roots.push(root)
  containers.push(container)
  return container
}

async function waitForText(container: HTMLElement, text: string): Promise<void> {
  await waitFor(() => {
    expect(container.textContent).toContain(text)
  })
}

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 2000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    }
  }
  throw lastError
}

function getSelect(container: HTMLElement, label: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  if (!select) {
    throw new Error(`Select not found: ${label}`)
  }
  return select
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label)
  if (!button) {
    throw new Error(`Button not found: ${label}`)
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
