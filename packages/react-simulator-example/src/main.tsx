import React from 'react'
import { createRoot } from 'react-dom/client'
import { ZebricSimulator } from '@zebric/react-simulator'
import '@zebric/react-simulator/styles.css'
import './styles.css'

const defaultBlueprintToml = `version = "0.2.0"

[project]
name = "Task Board"
version = "1.0.0"
description = "Browser-only simulator example"

[project.runtime]
min_version = "0.2.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "status", type = "Enum", values = ["todo", "doing", "done"], default = "todo" },
  { name = "notes", type = "LongText" }
]

[entity.Task.access]
read = true
create = true
update = true
delete = { "$currentUser.role" = "manager" }

[page."/"]
title = "Tasks"
auth = "optional"
layout = "list"

[page."/".queries.tasks]
entity = "Task"
orderBy = { title = "asc" }

[page."/tasks/new"]
title = "New Task"
auth = "optional"
layout = "form"

[page."/tasks/new".form]
entity = "Task"
method = "create"
onSuccess = { redirect = "/", message = "Task created" }

[[page."/tasks/new".form.fields]]
name = "title"
type = "text"
label = "Title"
required = true

[[page."/tasks/new".form.fields]]
name = "status"
type = "select"
label = "Status"
options = ["todo", "doing", "done"]

[[page."/tasks/new".form.fields]]
name = "notes"
type = "textarea"
label = "Notes"
rows = 4

[page."/tasks/:id"]
title = "Task Detail"
auth = "optional"
layout = "detail"

[page."/tasks/:id".queries.task]
entity = "Task"
where = { id = "{id}" }

[page."/tasks/:id".actionBar]
title = "Task actions"
showStatus = true
statusField = "status"

[[page."/tasks/:id".actionBar.actions]]
label = "Mark done"
workflow = "MarkTaskDone"
payload = { status = "done" }
successMessage = "Workflow simulated"

[workflow.MarkTaskDone]
trigger = { manual = true }

[[workflow.MarkTaskDone.steps]]
type = "plugin"
plugin = "tasks"
action = "markDone"
`

const exampleSeeds = {
  demo: {
    Task: [
      {
        id: 'task-1',
        title: 'Review simulator plan',
        status: 'doing',
        ownerId: 'manager',
        notes: 'Use the workflow tab to inspect simulated actions.',
      },
      {
        id: 'task-2',
        title: 'Try the textarea editor',
        status: 'todo',
        ownerId: 'user',
        notes: 'Blueprint changes re-render in the browser.',
      },
    ],
  },
  empty: {
    Task: [],
  },
}

function App() {
  const [blueprintToml, setBlueprintToml] = React.useState(defaultBlueprintToml)

  return (
    <main className="example-shell">
      <section className="editor-pane" aria-label="Blueprint editor">
        <div className="pane-header">
          <div>
            <h1>Zebric Simulator Example</h1>
            <p>Edit the blueprint TOML and preview it in the browser.</p>
          </div>
          <button type="button" onClick={() => setBlueprintToml(defaultBlueprintToml)}>
            Reset
          </button>
        </div>
        <textarea
          value={blueprintToml}
          onChange={(event) => setBlueprintToml(event.target.value)}
          spellCheck={false}
          aria-label="Blueprint TOML"
        />
      </section>

      <section className="preview-pane" aria-label="Simulator preview">
        <ZebricSimulator
          blueprintToml={blueprintToml}
          seeds={exampleSeeds}
          initialSeed="demo"
          initialAccount="manager"
          pluginPolicy={{ defaultLevel: 1 }}
          apiPolicy={{ mode: 'debug' }}
        />
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
