import { describe, expect, it } from 'vitest'
import { evaluateCondition } from './conditions.js'

describe('evaluateCondition', () => {
  it('matches direct fields, arrays, and operators', () => {
    const record = { status: 'Submitted', priority: 3 }

    expect(evaluateCondition({ status: 'Submitted' }, record)).toBe(true)
    expect(evaluateCondition({ status: ['Submitted', 'In Review'] }, record)).toBe(true)
    expect(evaluateCondition({ priority: { $gte: 2, $lt: 5 } }, record)).toBe(true)
    expect(evaluateCondition({ status: 'Approved' }, record)).toBe(false)
  })

  it('matches nested context paths and compound expressions', () => {
    const context = {
      variables: { data: { record: { status: 'Approved' } } },
      session: { user: { role: 'coordinator' } },
    }

    expect(evaluateCondition({
      $and: [
        { 'variables.data.record.status': 'Approved' },
        { 'session.user.role': 'coordinator' },
      ],
    }, context)).toBe(true)
    expect(evaluateCondition({
      $or: [
        { 'variables.data.record.status': 'Rejected' },
        { 'session.user.role': 'admin' },
      ],
    }, context)).toBe(false)
  })

  it('does not let $ne (or other operators) vacuously match a missing/unresolved value', () => {
    expect(evaluateCondition({ status: { $ne: 'archived' } }, null)).toBe(false)
    expect(evaluateCondition({ status: { $ne: 'archived' } }, undefined)).toBe(false)
    expect(evaluateCondition({ status: { $ne: 'archived' } }, {})).toBe(false)
    expect(evaluateCondition({ status: { $gt: 1 } }, {})).toBe(false)

    expect(evaluateCondition({ status: { $ne: 'archived' } }, { status: 'draft' })).toBe(true)
  })

  it('throws on an unrecognized operator instead of silently failing to match', () => {
    expect(() => evaluateCondition({ status: { $in: ['a', 'b'] } }, { status: 'a' }))
      .toThrow('Unknown operator: $in')
  })
})
