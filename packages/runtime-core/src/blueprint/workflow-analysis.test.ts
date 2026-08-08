import { describe, expect, it } from 'vitest'
import { BlueprintParser } from './loader.js'
import { analyzeTransactionalWorkflow } from './workflow-analysis.js'
import type { Workflow } from '../types/blueprint.js'

describe('transactional workflow analysis', () => {
  it('recognizes a fixed database-only workflow as D1 batch eligible', () => {
    expect(analyzeTransactionalWorkflow(workflow([
      { type: 'query', entity: 'Issue', action: 'update' },
      { type: 'query', entity: 'Result', action: 'create' },
    ]))).toEqual({ databaseOnly: true, d1BatchEligible: true, reasons: [] })
  })

  it('keeps database-only dynamic workflows valid while excluding them from D1 batches', () => {
    const analysis = analyzeTransactionalWorkflow(workflow([{
      type: 'condition',
      if: { 'variables.allowed': true },
      then: [{ type: 'query', entity: 'Issue', action: 'update' }],
    }]))
    expect(analysis.databaseOnly).toBe(true)
    expect(analysis.d1BatchEligible).toBe(false)
  })

  it('excludes workflows whose statements depend on an earlier query result', () => {
    const analysis = analyzeTransactionalWorkflow(workflow([
      { type: 'query', entity: 'Column', action: 'find', assignTo: 'column' },
      {
        type: 'query',
        entity: 'Issue',
        action: 'update',
        data: { columnId: '{{ variables.column.id }}' },
      },
    ]))
    expect(analysis.databaseOnly).toBe(true)
    expect(analysis.d1BatchEligible).toBe(false)
    expect(analysis.reasons).toContain('workflow.Test.steps[1] depends on intermediate result "column"')
  })

  it('rejects external effects in transactional Blueprints', () => {
    expect(() => new BlueprintParser().parse(`
      version = "1.0.0"
      [project]
      name = "Unsafe Transaction"
      version = "1.0.0"
      [project.runtime]
      min_version = "0.3.0"
      [workflow.Unsafe]
      transactional = true
      trigger = { manual = true }
      [[workflow.Unsafe.steps]]
      type = "webhook"
      url = "https://example.com"
      method = "POST"
    `, 'toml')).toThrow('must contain only database query steps')
  })
})

function workflow(steps: any[]): Workflow {
  return { name: 'Test', trigger: { manual: true }, transactional: true, steps }
}
