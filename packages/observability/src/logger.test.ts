import { describe, expect, it, vi } from 'vitest'
import { createLogger } from './logger.js'
import { ConsoleTransport } from './transport.js'

describe('createLogger', () => {
  it('merges child context into emitted logs', () => {
    const write = vi.fn()
    const logger = createLogger({
      transport: { write },
      context: { serviceName: 'runtime-node' },
    })

    logger.child({ correlationId: 'corr_123' }).info('hello', { pluginName: 'demo' })

    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      message: 'hello',
      level: 'info',
      context: expect.objectContaining({
        serviceName: 'runtime-node',
        correlationId: 'corr_123',
        pluginName: 'demo',
      }),
    }))
  })

  it('serializes errors and redacts sensitive keys', () => {
    const write = vi.fn()
    const logger = createLogger({
      transport: { write },
    })

    logger.error('boom', {
      authorization: 'Bearer secret',
      error: new Error('failure'),
    })

    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        authorization: '[REDACTED]',
        error: expect.objectContaining({
          message: 'failure',
        }),
      }),
    }))
  })

  it('supports the console transport', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const transport = new ConsoleTransport()

    transport.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'hello',
      context: {},
    })

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
