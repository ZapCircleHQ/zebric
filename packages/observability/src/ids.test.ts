import { describe, expect, it } from 'vitest'
import {
  createCorrelationId,
  createExecutionId,
  createRequestId,
  isValidTraceId,
  resolveCorrelationId,
} from './ids.js'

describe('ids', () => {
  it('creates prefixed ids', () => {
    expect(createCorrelationId()).toMatch(/^corr_/)
    expect(createRequestId()).toMatch(/^req_/)
    expect(createExecutionId()).toMatch(/^exec_/)
  })

  it('validates supported inbound trace ids', () => {
    expect(isValidTraceId('abc-123:def')).toBe(true)
    expect(isValidTraceId('bad value')).toBe(false)
  })

  it('prefers a valid inbound correlation id', () => {
    const headers = new Headers({
      'x-correlation-id': 'corr_existing',
    })

    expect(resolveCorrelationId(headers)).toBe('corr_existing')
  })

  it('generates a new correlation id for invalid inbound values', () => {
    const headers = new Headers({
      'x-correlation-id': 'bad value',
    })

    expect(resolveCorrelationId(headers)).toMatch(/^corr_/)
  })
})
