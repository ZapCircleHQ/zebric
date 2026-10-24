import { describe, expect, it } from 'vitest'
import { auditBlueprint } from './audit.js'
import { BlueprintParser } from './loader.js'
import type { Blueprint } from '../types/blueprint.js'

function blueprint(): Blueprint {
  return {
    version: '1.0.0', project: { name: 'Audit', version: '1.0.0', runtime: { min_version: '0.3.0' } },
    entities: [{ name: 'Task', fields: [{ name: 'id', type: 'ULID', primary_key: true }],
      access: { read: 'public', create: 'authenticated', update: false, delete: false } }],
    pages: [{ path: '/', title: 'Tasks', queries: { tasks: { entity: 'Task', limit: 20 } } }],
  }
}

describe('auditBlueprint', () => {
  it('accepts a validated blueprint and returns a clean report without mutating it', () => {
    const bp = new BlueprintParser().parse(JSON.stringify(blueprint()), 'json')
    const before = JSON.stringify(bp)
    expect(auditBlueprint(bp)).toEqual({ version: 1, findings: [], summary: { error: 0, warning: 0, info: 0 } })
    expect(JSON.stringify(bp)).toBe(before)
  })

  it('distinguishes omitted access from explicit public mutations and restrictive policies', () => {
    const bp = blueprint()
    bp.entities[0]!.access = { read: true, create: 'public', update: true }
    const report = auditBlueprint(bp)
    expect(report.findings.map(f => [f.ruleId, f.path])).toEqual([
      ['access.implicit', ['entities', 0, 'access']],
      ['access.public-mutation', ['entities', 0, 'access', 'create']],
      ['access.public-mutation', ['entities', 0, 'access', 'update']],
    ])
    expect(report.findings[0]!.message).toContain('delete')
    expect(report.summary).toEqual({ error: 0, warning: 3, info: 0 })
  })

  it('requires a leading reference index, recognizing field and composite indexes', () => {
    const bp = blueprint()
    bp.entities[0]!.fields.push(
      { name: 'a', type: 'Ref', index: true }, { name: 'b', type: 'Ref', unique: true },
      { name: 'c', type: 'Ref' }, { name: 'd', type: 'Ref' },
      { name: 'e', type: 'Ref', primary_key: true },
    )
    bp.entities[0]!.indexes = [{ fields: ['c', 'd'] }]
    expect(auditBlueprint(bp).findings.map(f => f.path)).toEqual([['entities', 0, 'fields', 4]])
  })

  it('reports missing limits and unordered offsets, with deterministic query-key ordering', () => {
    const bp = blueprint()
    bp.pages[0]!.queries = {
      z: { entity: 'Task', offset: 10 }, a: { entity: 'Task' },
      bounded: { entity: 'Task', limit: 20, offset: 10, orderBy: { id: 'asc' } },
    }
    const first = auditBlueprint(bp)
    bp.pages[0]!.queries = Object.fromEntries(Object.entries(bp.pages[0]!.queries!).reverse())
    bp.hash = 'machine-specific-input-hash'
    expect(auditBlueprint(bp)).toEqual(first)
    expect(first.findings.map(f => f.ruleId)).toEqual(['query.offset-without-order', 'query.unbounded', 'query.unbounded'])
  })

  it('inspects active workflows and plugins without guessing deployment secrets', () => {
    const bp = blueprint()
    bp.workflows = [
      { name: 'default', trigger: { webhook: '/hook' }, steps: [] },
      { name: 'dedicated', trigger: { webhook: '/other', webhookSecretEnv: 'SECRET' }, steps: [] },
      { name: 'inactive', enabled: false, trigger: {}, steps: [] },
      { name: 'missing', trigger: { entity: 'Task' }, steps: [] },
      { name: 'event', trigger: { entity: 'Task', event: 'create' }, steps: [] },
      { name: 'manual', trigger: { manual: true }, steps: [] },
      { name: 'scheduled', trigger: { schedule: '* * * * *' }, steps: [] },
    ]
    bp.plugins = [
      { name: 'full', enabled: true, trust_level: 'full' },
      { name: 'disabled', enabled: false, trust_level: 'full' },
      { name: 'limited', enabled: true },
    ]
    expect(auditBlueprint(bp).findings.map(f => f.ruleId)).toEqual([
      'plugin.full-trust', 'workflow.no-trigger', 'workflow.webhook-default-secret',
    ])
  })

  it('does not treat zero or negative limits as bounded queries', () => {
    const bp = blueprint()
    bp.pages[0]!.queries = { zero: { entity: 'Task', limit: 0 }, negative: { entity: 'Task', limit: -1 } }
    expect(auditBlueprint(bp).findings.map(f => f.ruleId)).toEqual(['query.unbounded', 'query.unbounded'])
  })
})
