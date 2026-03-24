import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createLogger } from './logger.js'
import { createHonoLoggerMiddleware, getHonoLogger } from './hono.js'

describe('createHonoLoggerMiddleware', () => {
  it('injects a request-scoped logger and returns correlation headers', async () => {
    const write = vi.fn()
    const logger = createLogger({
      transport: { write },
    })
    const app = new Hono()

    app.use('*', createHonoLoggerMiddleware(logger, { logStart: true }))
    app.get('/', (c) => {
      const requestLogger = getHonoLogger(c)
      requestLogger?.info('inside handler')
      return c.text('ok')
    })

    const response = await app.request('http://example.com/', {
      headers: {
        'x-correlation-id': 'corr_from_client',
      },
    })

    expect(response.headers.get('x-correlation-id')).toBe('corr_from_client')
    expect(response.headers.get('x-request-id')).toMatch(/^req_/)
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      message: 'inside handler',
      context: expect.objectContaining({
        correlationId: 'corr_from_client',
        method: 'GET',
        path: '/',
      }),
    }))
  })
})
