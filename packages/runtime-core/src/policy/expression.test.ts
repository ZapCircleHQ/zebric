import { describe, expect, it } from 'vitest'
import { ExpressionEvaluationError } from '../errors/domain-errors.js'
import { evaluateExpression, expressionPaths, parseExpression } from './expression.js'

describe('policy expression language', () => {
  const context = {
    actor: { id: 'agent-1', effectiveId: 'sarah', roles: ['agent', 'approver'] },
    record: { status: 'pending', requestedFromId: 'sarah', score: 8, tags: ['hot', 'review'] },
    input: { adjustment: 2 },
    workflow: { stage: 'approval' },
    now: new Date('2026-09-29T12:00:00.000Z'),
  }

  it('evaluates boolean, comparison, arithmetic and null expressions', () => {
    expect(evaluateExpression(
      'record.status == "pending" && record.requestedFromId == actor.effectiveId && record.score + input.adjustment >= 10',
      context,
    )).toBe(true)
    expect(evaluateExpression('record.missing == null || false', context)).toBe(false)
    expect(evaluateExpression('record.score % 3 == 2', context)).toBe(true)
  })

  it('supports constrained collection operations and array literals', () => {
    expect(evaluateExpression('record.tags contains "hot"', context)).toBe(true)
    expect(evaluateExpression('actor.effectiveId in ["sarah", "lee"]', context)).toBe(true)
    expect(evaluateExpression('actor.roles contains "admin"', context)).toBe(false)
  })

  it('uses a caller-supplied stable now value', () => {
    expect(evaluateExpression('now >= now', context)).toBe(true)
  })

  it('extracts paths for relationship hydration', () => {
    expect(expressionPaths('record.team.members.userId contains actor.effectiveId'))
      .toEqual(['record.team.members.userId', 'actor.effectiveId'])
  })

  it('rejects malformed or unsafe syntax', () => {
    expect(() => parseExpression('record.status = "pending"')).toThrow(ExpressionEvaluationError)
    expect(() => parseExpression('record["status"] == "pending"')).toThrow(ExpressionEvaluationError)
    expect(() => evaluateExpression('10 / 0', context)).toThrow('Division by zero')
  })
})
