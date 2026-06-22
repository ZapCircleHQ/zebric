import { describe, expect, it } from 'vitest'
import { BlueprintParser } from './loader.js'

const parser = new BlueprintParser()

function boardBlueprint(overrides = ''): string {
  return `
version = "1.0"

[project]
name = "board-test"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "status", type = "Enum", values = ["todo", "done"] },
  { name = "position", type = "Integer", default = 0 }
]

[page."/board"]
title = "Board"
layout = "board"

[page."/board".query.tasks]
entity = "Task"

${overrides || `
[page."/board".board]
query = "tasks"
groupBy = "status"
orderBy = "position"

[[page."/board".board.columns]]
value = "todo"
label = "To do"

[[page."/board".board.columns]]
value = "done"
label = "Done"

[page."/board".board.card]
title = "title"
href = "/tasks/{id}"

[page."/board".board.move]
workflow = "SetTaskStatus"
payloadField = "status"
`}

[workflow.SetTaskStatus]
trigger = { manual = true }
steps = []
`
}

describe('board blueprint parsing', () => {
  it('parses first-class board configuration', () => {
    const blueprint = parser.parse(boardBlueprint(), 'toml')
    const board = blueprint.pages[0].board

    expect(board?.query).toBe('tasks')
    expect(board?.columns.map((column) => column.value)).toEqual(['todo', 'done'])
    expect(board?.move?.workflow).toBe('SetTaskStatus')
  })

  it('requires board configuration for the board layout', () => {
    expect(() => parser.parse(boardBlueprint('# no board'), 'toml'))
      .toThrow('uses the board layout without board configuration')
  })

  it('rejects unknown board queries', () => {
    expect(() => parser.parse(boardBlueprint(`
[page."/board".board]
query = "missing"
groupBy = "status"
columns = [{ value = "todo", label = "To do" }]
card = { title = "title" }
`), 'toml')).toThrow('board references unknown query "missing"')
  })

  it('rejects unknown board fields', () => {
    expect(() => parser.parse(boardBlueprint(`
[page."/board".board]
query = "tasks"
groupBy = "missing"
columns = [{ value = "todo", label = "To do" }]
card = { title = "title" }
`), 'toml')).toThrow('board references unknown field "Task.missing"')
  })

  it('rejects unknown move workflows', () => {
    expect(() => parser.parse(boardBlueprint(`
[page."/board".board]
query = "tasks"
groupBy = "status"
columns = [{ value = "todo", label = "To do" }]
card = { title = "title" }
move = { workflow = "MissingWorkflow" }
`), 'toml')).toThrow('board move references unknown workflow "MissingWorkflow"')
  })
})
