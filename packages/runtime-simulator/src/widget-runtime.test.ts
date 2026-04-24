import { describe, expect, it } from 'vitest'
import { ZebricSimulatorRuntime } from './simulator-runtime.js'

const widgetBlueprint = `version = "0.2.0"

[project]
name = "Widget Smoke"
version = "1.0.0"

[project.runtime]
min_version = "0.2.0"

[entity.Column]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "name", type = "Text", required = true },
  { name = "position", type = "Integer", default = 0 }
]

[entity.Column.access]
read = true
create = true
update = true
delete = true

[entity.Issue]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "columnId", type = "Ref", ref = "Column.id", required = true },
  { name = "position", type = "Integer", default = 0 },
  { name = "important", type = "Boolean", default = false }
]

[entity.Issue.access]
read = true
create = true
update = true
delete = true

[page."/"]
title = "Board"
auth = "optional"

[page."/".query.columns]
entity = "Column"
orderBy = { position = "asc" }

[page."/".query.issues]
entity = "Issue"
orderBy = { position = "asc" }

[page."/".widget]
kind = "board"
entity = "Issue"
group_by = "columnId"
column_entity = "Column"
column_label = "name"
column_order = "position"
rank_field = "position"

[page."/".widget.card]
title = "title"
toggles = [ { field = "important", label_on = "★", label_off = "☆" } ]

[page."/".widget.on_move]
update = { columnId = "$to.id", position = "$index" }

[page."/".widget.on_column_rename]
update = { name = "$value" }

[page."/".widget.on_toggle]
update = { "$field" = "!$row.$field" }

[page."/customers"]
title = "Customer Search"
auth = "optional"

[page."/customers".widget]
kind = "lookup"
entity = "Customer"
search = ["lastName", "firstName", "email"]
display = "{lastName}, {firstName}"
limit = 5

[page."/customers".widget.on_select]
navigate = "/customers/$to.id"

[entity.Customer]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "firstName", type = "Text", required = true },
  { name = "lastName", type = "Text", required = true },
  { name = "email", type = "Email", required = true }
]

[entity.Customer.access]
read = true
create = true
update = true
delete = true
`

const seed = {
  Column: [
    { id: 'col-backlog', name: 'Backlog', position: 0 },
    { id: 'col-done', name: 'Done', position: 1 },
  ],
  Issue: [
    { id: 'iss-1', title: 'Write widget system', columnId: 'col-backlog', position: 0, important: false },
    { id: 'iss-2', title: 'Ship the board', columnId: 'col-backlog', position: 1, important: true },
  ],
  Customer: [
    { id: 'cus-1', firstName: 'Sarah', lastName: 'Chen', email: 'sarah@acme.com' },
    { id: 'cus-2', firstName: 'James', lastName: 'Smith', email: 'j.smith@acme.com' },
    { id: 'cus-3', firstName: 'Mei', lastName: 'Smith', email: 'mei@globex.com' },
  ],
}

describe('Simulator widget runtime', () => {
  it('renders a board page with data-control and inlines the client runtime', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml: widgetBlueprint,
      seeds: { demo: seed },
      initialSeed: 'demo',
      initialAccount: null,
    })

    const rendered = await runtime.render('/')
    expect(rendered.status).toBe(200)
    expect(rendered.html).toContain('data-control="board"')
    expect(rendered.html).toContain('Write widget system')
    expect(rendered.html).toContain('Ship the board')
    // Client runtime inlined for widget pages
    expect(rendered.html).toContain('initBoard')
    expect(rendered.html).toContain('initLookup')
  })

  it('handles a toggle event and persists the flip', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml: widgetBlueprint,
      seeds: { demo: seed },
      initialSeed: 'demo',
      initialAccount: null,
    })

    const result = await runtime.simulateWidgetEvent({
      page: '/',
      event: 'toggle',
      row: { entity: 'Issue', id: 'iss-1' },
      ctx: { field: 'important' },
    })

    expect(result.success).toBe(true)
    expect(result.record.important).toBe(true)

    const issues = runtime.getState().data.Issue
    expect(issues?.find((i: any) => i.id === 'iss-1')?.important).toBe(true)
  })

  it('handles a move event (column + position update)', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml: widgetBlueprint,
      seeds: { demo: seed },
      initialSeed: 'demo',
      initialAccount: null,
    })

    const result = await runtime.simulateWidgetEvent({
      page: '/',
      event: 'move',
      row: { entity: 'Issue', id: 'iss-1' },
      ctx: { to: { id: 'col-done' }, index: 0 },
    })

    expect(result.success).toBe(true)
    expect(result.record.columnId).toBe('col-done')
    expect(result.record.position).toBe(0)
  })

  it('handles a column_rename event', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml: widgetBlueprint,
      seeds: { demo: seed },
      initialSeed: 'demo',
      initialAccount: null,
    })

    const result = await runtime.simulateWidgetEvent({
      page: '/',
      event: 'column_rename',
      row: { entity: 'Column', id: 'col-backlog' },
      ctx: { field: 'name', value: 'Todo' },
    })

    expect(result.success).toBe(true)
    expect(result.record.name).toBe('Todo')
  })

  it('rejects unknown widget events with 400', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml: widgetBlueprint,
      seeds: { demo: seed },
      initialSeed: 'demo',
      initialAccount: null,
    })

    const result = await runtime.simulateWidgetEvent({
      page: '/',
      event: 'delete_everything',
      row: { entity: 'Issue', id: 'iss-1' },
      ctx: {},
    })

    expect(result.error).toContain('Unknown widget event')
  })

  it('handles lookup search across multiple fields', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml: widgetBlueprint,
      seeds: { demo: seed },
      initialSeed: 'demo',
      initialAccount: null,
    })

    const smi = await runtime.simulateLookupSearch({ page: '/customers', q: 'smi' })
    expect(smi.results).toHaveLength(2)
    expect(smi.results.map((r: any) => r.label).sort()).toEqual(['Smith, James', 'Smith, Mei'])

    const chen = await runtime.simulateLookupSearch({ page: '/customers', q: 'chen' })
    expect(chen.results).toHaveLength(1)
    expect(chen.results[0].label).toBe('Chen, Sarah')

    const empty = await runtime.simulateLookupSearch({ page: '/customers', q: 'xyz' })
    expect(empty.results).toEqual([])
  })

  it('respects the limit option', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml: widgetBlueprint,
      seeds: { demo: seed },
      initialSeed: 'demo',
      initialAccount: null,
    })

    // All three customers match "a" in one of their fields — but limit=5 still caps input.
    const all = await runtime.simulateLookupSearch({ page: '/customers', q: '@' })
    expect(all.results.length).toBeLessThanOrEqual(5)
  })

  it('returns 404 body for page without a widget/form lookup', async () => {
    const runtime = new ZebricSimulatorRuntime({
      blueprintToml: widgetBlueprint,
      seeds: { demo: seed },
      initialSeed: 'demo',
      initialAccount: null,
    })

    const missing = await runtime.simulateLookupSearch({ page: '/', q: 'anything' })
    expect(missing.error).toContain('No lookup configured')
  })
})
