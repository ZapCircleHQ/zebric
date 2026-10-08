import { describe, expect, it } from 'vitest'
import { BlueprintParser } from '../blueprint/loader.js'
import { discoverLiveDependencies, resolveLiveConfig, validLiveCursor } from './live.js'

const blueprint = `version = "1.0"
[project]
name = "Live"
version = "1.0"
[project.runtime]
min_version = "0.1"
[page."/tasks"]
title = "Tasks"
live = true
[page."/tasks".query.tasks]
entity = "Task"
[entity.Task]
fields = [{ name = "id", type = "ULID", primary_key = true }]
`

describe('Live Blueprint contract', () => {
  it('preserves top-level TOML live settings through parsing', () => {
    const parsed = new BlueprintParser().parse(blueprint + `
[live]
reauthorize_interval_seconds = 1
change_retention_hours = 0
`, 'toml')
    expect(parsed.live).toEqual({ reauthorize_interval_seconds: 1, change_retention_hours: 0 })
    expect(resolveLiveConfig(parsed)).toEqual({ reauthorizeIntervalMs: 1_000, changeRetentionMs: 0 })
  })
  it('recognizes live=true in TOML and JSON and rejects non-booleans', () => {
    const parser = new BlueprintParser()
    const parsed = parser.parse(blueprint, 'toml')
    expect(parsed.pages[0].live).toBe(true)
    expect(parser.parse(JSON.stringify(parsed), 'json').pages[0].live).toBe(true)
    expect(() => parser.parse(blueprint.replace('live = true', 'live = "true"'), 'toml')).toThrow()
  })
  it('includes query, widget, form, and lookup dependencies without duplicates', () => {
    expect(discoverLiveDependencies({ path: '/tasks', title: 'Tasks', queries: { tasks: { entity: 'Task' }, other: { entity: 'Project' } },
      widget: { kind: 'board', entity: 'Task', column_entity: 'Status' },
      form: { entity: 'Task', method: 'update', fields: [{ name: 'owner', type: 'lookup', lookup: { entity: 'User', search: ['name'] } }] },
    })).toEqual(['Task', 'Project', 'Status', 'User'].map(entity => ({ entity })))
  })
  it('validates bounded ordered cursors', () => {
    expect(validLiveCursor('0')).toBe(true)
    expect(validLiveCursor('9007199254740991')).toBe(true)
    for (const value of ['-1', '1.5', 'NaN', '9007199254740992', '', ' 1', '1 ', '+1', '1e2', '0x10', 'Infinity']) expect(validLiveCursor(value)).toBe(false)
  })

  it.each(['live = false', '# live omitted'])('keeps opt-in semantics for %s', setting => {
    const parsed = new BlueprintParser().parse(blueprint.replace('live = true', setting), 'toml')
    expect(Boolean(parsed.pages[0].live)).toBe(false)
  })

  it.each([
    'reauthorize_interval_seconds = 0',
    'reauthorize_interval_seconds = -1',
    'reauthorize_interval_seconds = "30"',
    'change_retention_hours = -1',
    'change_retention_hours = "24"',
  ])('rejects invalid live configuration: %s', setting => {
    expect(() => new BlueprintParser().parse(blueprint + '\n[live]\n' + setting, 'toml')).toThrow()
  })
})

describe('resolveLiveConfig', () => {
  it('applies defaults and converts configured units to milliseconds', () => {
    expect(resolveLiveConfig()).toEqual({ reauthorizeIntervalMs: 30_000, changeRetentionMs: 86_400_000 })
    expect(resolveLiveConfig({ live: { reauthorize_interval_seconds: 5, change_retention_hours: 0 } }))
      .toEqual({ reauthorizeIntervalMs: 5_000, changeRetentionMs: 0 })
  })
})
