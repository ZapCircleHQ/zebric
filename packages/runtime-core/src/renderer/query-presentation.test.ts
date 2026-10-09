import { describe, expect, it } from 'vitest'
import { BlueprintParser } from '../blueprint/loader.js'
import { ComponentRenderers } from './component-renderers.js'
import { RendererUtils } from './renderer-utils.js'
import { defaultTheme } from './theme.js'
import type { Blueprint, Page } from '../types/blueprint.js'

const parser = new BlueprintParser()

const baseToml = (pageQueries: string, extraEntity = '') => `
version = "1.0"

[project]
name = "presentation"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[entity.Change]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text" }
]

[entity.Check]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "changeId", type = "Ref", ref = "Change.id" },
  { name = "stage", type = "Text" },
  { name = "outcome", type = "Text" },
  { name = "detail", type = "LongText" }${extraEntity}
]

[page."/changes/:id"]
title = "Change"
layout = "detail"

[page."/changes/:id".query.change]
entity = "Change"
where = { id = "$params.id" }

${pageQueries}
`

describe('page query presentation options (schema)', () => {
  it('accepts display, title, empty and columns', () => {
    const blueprint = parser.parse(baseToml(`
[page."/changes/:id".query.checks]
entity = "Check"
display = "table"
title = "Verification"
empty = "Nothing has run yet."
columns = ["stage", { field = "outcome", label = "Result" }, { field = "detail", wrap = true }]
`), 'toml')
    const query = blueprint.pages[0].queries!.checks
    expect(query.display).toBe('table')
    expect(query.title).toBe('Verification')
    expect(query.empty).toBe('Nothing has run yet.')
    expect(query.columns).toEqual(['stage', { field: 'outcome', label: 'Result' }, { field: 'detail', wrap: true }])
  })

  it('rejects an unknown display value', () => {
    expect(() => parser.parse(baseToml(`
[page."/changes/:id".query.checks]
entity = "Check"
display = "carousel"
`), 'toml')).toThrow()
  })

  it('rejects an empty columns list', () => {
    expect(() => parser.parse(baseToml(`
[page."/changes/:id".query.checks]
entity = "Check"
columns = []
`), 'toml')).toThrow()
  })

  it('accepts show_identifiers on a field', () => {
    const blueprint = parser.parse(baseToml('', `,
  { name = "options", type = "JSON", show_identifiers = true }`), 'toml')
    expect(blueprint.entities.find(e => e.name === 'Check')!.fields.find(f => f.name === 'options')!.show_identifiers).toBe(true)
  })
})

describe('RendererUtils column helpers', () => {
  const entity = {
    name: 'Check',
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      { name: 'changeId', type: 'Ref' },
      { name: 'stage', type: 'Text' },
      { name: 'detail', type: 'LongText' },
      { name: 'options', type: 'JSON', show_identifiers: true },
    ],
  }
  const utils = new RendererUtils({ entities: [entity], pages: [] } as any)

  it('resolves columns in the order given, with labels and wrap overrides', () => {
    expect(utils.resolveColumns(['detail', { field: 'stage', label: 'Step', wrap: false }], entity)).toEqual([
      { name: 'detail', type: 'LongText' },
      { name: 'stage', type: 'Text', label: 'Step', wrap: false },
    ])
  })

  it('allows an explicitly named identifier field, which is hidden by default', () => {
    expect(utils.getDisplayFields({}, entity).map(f => f.name)).not.toContain('changeId')
    expect(utils.resolveColumns(['changeId'], entity).map(c => c.name)).toEqual(['changeId'])
  })

  it('ignores columns that are not fields of the entity, and resolves nothing for an empty list', () => {
    expect(utils.resolveColumns(['stage', 'nope'], entity).map(c => c.name)).toEqual(['stage'])
    expect(utils.resolveColumns(['nope'], entity)).toEqual([])
    expect(utils.resolveColumns(undefined, entity)).toEqual([])
    expect(utils.resolveColumns([], entity)).toEqual([])
  })

  it('carries a field-level show_identifiers opt-out through to the column', () => {
    expect(utils.resolveColumns(['options'], entity)[0].showIdentifiers).toBe(true)
    expect(utils.getDisplayFields({}, entity).find(f => f.name === 'options')!.showIdentifiers).toBe(true)
  })

  it('wraps long free text and JSON, keeps short values on one line, and honors an override', () => {
    expect(utils.shouldWrapColumn('LongText', ['short'])).toBe(true)
    expect(utils.shouldWrapColumn('JSON', [{}])).toBe(true)
    expect(utils.shouldWrapColumn('Text', ['short', 'also short'])).toBe(false)
    expect(utils.shouldWrapColumn('Text', ['x'.repeat(49)])).toBe(true)
    expect(utils.shouldWrapColumn('Text', ['x'.repeat(48)])).toBe(false)
    expect(utils.shouldWrapColumn('Text', [null, 5, undefined])).toBe(false)
    expect(utils.shouldWrapColumn('LongText', ['x'], false)).toBe(false)
    expect(utils.shouldWrapColumn('Text', ['x'], true)).toBe(true)
  })

  it('hides identifier-looking JSON keys unless the field opts out', () => {
    const value = { id: 'abc', label: 'Return' }
    expect(JSON.parse(utils.formatValue(value, 'JSON'))).toEqual({ label: 'Return' })
    expect(JSON.parse(utils.formatValue(value, 'JSON', { showIdentifiers: true }))).toEqual({ id: 'abc', label: 'Return' })
    expect(JSON.parse(utils.formatValue([{ id: 'a', label: 'x' }], 'JSON', { showIdentifiers: false }))).toEqual([{ label: 'x' }])
  })
})

function makeRenderer(pageOverrides: Partial<Page> = {}) {
  const blueprint = {
    version: '1.0',
    project: { name: 'T', version: '1', runtime: { min_version: '0.1.0' } },
    entities: [
      { name: 'Change', fields: [{ name: 'id', type: 'ULID', primary_key: true }, { name: 'title', type: 'Text' }] },
      {
        name: 'Check',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'changeId', type: 'Ref', ref: 'Change.id' },
          { name: 'stage', type: 'Text' },
          { name: 'outcome', type: 'Text' },
          { name: 'detail', type: 'LongText' },
        ],
      },
      { name: 'ChangeEvent', fields: [{ name: 'id', type: 'ULID', primary_key: true }, { name: 'kind', type: 'Text' }, { name: 'detail', type: 'LongText' }] },
      { name: 'Task', fields: [{ name: 'id', type: 'ULID', primary_key: true }, { name: 'title', type: 'Text' }] },
    ],
    pages: [],
  } as unknown as Blueprint
  const utils = new RendererUtils(blueprint)
  const renderer = new ComponentRenderers(blueprint, defaultTheme, utils)
  const page: Page = {
    path: '/changes/:id',
    title: 'Change',
    layout: 'detail',
    queries: {
      change: { entity: 'Change' },
      related: { entity: 'Check' },
    },
    ...pageOverrides,
  }
  const relatedRows = (rows: any[], query: any, entityName = 'Check') => {
    const p: Page = { ...page, queries: { change: { entity: 'Change' }, related: { ...query, entity: entityName } } }
    return renderer.renderRelatedData({ page: p, data: { change: { id: 'c1' }, related: rows } } as any).toString()
  }
  return { renderer, relatedRows }
}

const longDetail = "src/profile.ts(10,29): error TS18048: 'user' is possibly 'undefined'. ".repeat(3)
const checks = [
  { id: '1', changeId: 'c1', stage: 'typescript', outcome: 'failed', detail: longDetail },
  { id: '2', changeId: 'c1', stage: 'tests', outcome: 'not_run', detail: 'none' },
]

describe('table cells', () => {
  const { renderer } = makeRenderer()
  const entity = { name: 'Check', fields: [
    { name: 'id', type: 'ULID', primary_key: true },
    { name: 'stage', type: 'Text' },
    { name: 'outcome', type: 'Text' },
    { name: 'detail', type: 'LongText' },
  ] }
  const html = renderer.renderTable(checks, entity).toString()

  it('wraps long text instead of cutting it off, and keeps short columns on one line', () => {
    const cells = [...html.matchAll(/<td class="([^"]*)">/g)].map(m => m[1])
    const wrapped = cells.filter(c => c.includes('break-words'))
    const nowrap = cells.filter(c => c.includes('whitespace-nowrap'))
    expect(wrapped.length).toBe(2) // the detail column, one cell per row
    expect(wrapped.every(c => !c.includes('whitespace-nowrap'))).toBe(true)
    expect(nowrap.length).toBeGreaterThan(0) // stage and outcome stay on one line
  })

  it('puts the table in a horizontally scrolling container instead of clipping it', () => {
    expect(html).toMatch(/<div class="overflow-x-auto">\s*<table/)
    expect(html).toMatch(/<\/table>\s*<\/div>/)
  })

  it('still HTML-escapes the wrapped values', () => {
    const escaped = renderer.renderTable([{ id: '1', stage: 's', outcome: 'o', detail: '<script>alert(1)</script>' }], entity).toString()
    expect(escaped).not.toContain('<script>alert(1)')
    expect(escaped).toContain('&lt;script&gt;')
  })
})

describe('explicit columns on a table', () => {
  const { renderer } = makeRenderer()
  const entity = { name: 'Check', fields: [
    { name: 'id', type: 'ULID', primary_key: true },
    { name: 'changeId', type: 'Ref' },
    { name: 'stage', type: 'Text' },
    { name: 'outcome', type: 'Text' },
    { name: 'detail', type: 'LongText' },
  ] }

  it('shows only the named columns, in order, with custom labels', () => {
    const html = renderer.renderTable(checks, entity, undefined, { columns: ['outcome', { field: 'stage', label: 'Step' }] }).toString()
    const headers = [...html.matchAll(/<th scope="col"[^>]*>\s*([^<]*?)\s*<\/th>/g)].map(m => m[1])
    expect(headers).toEqual(['Outcome', 'Step', 'Actions'])
    expect(html).not.toContain('Detail')
  })

  it('lets a column opt out of wrapping, or into it', () => {
    const off = renderer.renderTable(checks, entity, undefined, { columns: [{ field: 'detail', wrap: false }] }).toString()
    expect(off).not.toContain('break-words')
    const on = renderer.renderTable(checks, entity, undefined, { columns: [{ field: 'stage', wrap: true }] }).toString()
    expect(on).toContain('break-words')
  })

  it('falls back to the default columns when none of the names resolve', () => {
    const html = renderer.renderTable(checks, entity, undefined, { columns: ['nope'] }).toString()
    expect(html).toContain('Stage')
    expect(html).toContain('Detail')
  })

  it('shows identifier fields only when they are named', () => {
    expect(renderer.renderTable(checks, entity).toString()).not.toContain('Change Id')
    expect(renderer.renderTable(checks, entity, undefined, { columns: ['changeId'] }).toString()).toContain('Change Id')
  })
})

describe('related sections: explicit display versus the entity-name convention', () => {
  const { relatedRows } = makeRenderer()
  const events = [{ id: 'e1', kind: 'change.ready', detail: 'ok' }]
  const rows = (html: string) => ({
    table: html.includes('<table'),
    feed: html.includes('role="list"'),
  })

  it('keeps the convention when no display is set: an Event entity is a feed, a Check entity a table', () => {
    expect(rows(relatedRows(events, {}, 'ChangeEvent'))).toEqual({ table: false, feed: true })
    expect(rows(relatedRows(checks, {}, 'Check'))).toEqual({ table: true, feed: false })
  })

  it('lets display override the convention in both directions', () => {
    expect(rows(relatedRows(events, { display: 'table' }, 'ChangeEvent'))).toEqual({ table: true, feed: false })
    expect(rows(relatedRows(checks, { display: 'feed' }, 'Check'))).toEqual({ table: false, feed: true })
  })

  it('supports the checklist and timeline presentations explicitly', () => {
    const tasks = [{ id: 't1', title: 'Write docs', completed: false }]
    expect(relatedRows(tasks, { display: 'checklist' }, 'Check')).toContain('Write docs')
    expect(relatedRows([{ id: 'm1', title: 'Beta', date: '2026-10-01' }], { display: 'timeline' }, 'Check')).toContain('Beta')
  })

  it('uses the query title as the section heading, else the formatted query name', () => {
    expect(relatedRows(checks, { title: 'Verification results' })).toContain('Verification results')
    expect(relatedRows(checks, {})).toContain('>Related<')
  })

  it('shows the query empty text, or the convention default', () => {
    expect(relatedRows([], { empty: 'Nothing has run yet.' })).toContain('Nothing has run yet.')
    expect(relatedRows([], { display: 'table', empty: 'None.' })).toContain('None.')
    expect(relatedRows([], {})).toContain('No related found')
    expect(relatedRows([], {}, 'ChangeEvent')).toContain('No recent activity')
  })

  it('passes columns through to the related table', () => {
    const html = relatedRows(checks, { columns: [{ field: 'outcome', label: 'Result' }] })
    expect(html).toContain('Result')
    expect(html).not.toContain('Stage')
  })

  it('escapes the heading and the empty text', () => {
    const html = relatedRows([], { title: '<b>x</b>', empty: '<i>y</i>' })
    expect(html).not.toContain('<b>x</b>')
    expect(html).not.toContain('<i>y</i>')
    expect(html).toContain('&lt;b&gt;x&lt;')
    expect(html).toContain('&lt;i&gt;y&lt;')
  })
})
