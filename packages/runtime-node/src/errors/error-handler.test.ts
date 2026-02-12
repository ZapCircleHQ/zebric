import { describe, it, expect, vi } from 'vitest'
import { ErrorHandler } from './error-handler.js'
import { ValidationException } from './base-error.js'

describe('ErrorHandler', () => {
  it('handles AppError with logger and request id', async () => {
    const sanitizer = {
      shouldLog: vi.fn(() => true),
      sanitize: vi.fn(() => ({ message: 'safe', code: 'SAFE' })),
    }
    const logger = { error: vi.fn() }
    const handler = new ErrorHandler({ sanitizer: sanitizer as any, logger })

    const req = new Request('http://example.com/path', {
      method: 'POST',
      headers: { 'x-request-id': 'req-123' },
    })
    const error = new ValidationException('bad input', { field: 'email' })

    const res = await handler.handle(error, req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(res.headers.get('X-Request-ID')).toBe('req-123')
    expect(json.error).toEqual({
      message: 'safe',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      requestId: 'req-123',
    })
    expect(sanitizer.shouldLog).toHaveBeenCalledWith(error)
    expect(sanitizer.sanitize).toHaveBeenCalledWith(error)
    expect(logger.error).toHaveBeenCalled()
  })

  it('uses default request id and status for generic errors', async () => {
    const sanitizer = {
      shouldLog: vi.fn(() => false),
      sanitize: vi.fn(() => ({ message: 'internal', code: 'INTERNAL' })),
    }
    const handler = new ErrorHandler({ sanitizer: sanitizer as any })

    const req = new Request('http://example.com/path')
    const res = await handler.handle(new Error('boom'), req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error.code).toBe('INTERNAL')
    expect(json.error.requestId).toBe('unknown')
  })

  it('prefers numeric statusCode field on non-AppError errors', async () => {
    const sanitizer = {
      shouldLog: vi.fn(() => false),
      sanitize: vi.fn(() => ({ message: 'teapot', code: 'X' })),
    }
    const handler = new ErrorHandler({ sanitizer: sanitizer as any })

    const err = Object.assign(new Error('teapot'), { statusCode: 418 })
    const res = await handler.handle(err, new Request('http://example.com/'))

    expect(res.status).toBe(418)
  })

  it('invokes custom onError and swallows onError failures', async () => {
    const sanitizer = {
      shouldLog: vi.fn(() => false),
      sanitize: vi.fn(() => ({ message: 'safe', code: 'SAFE' })),
    }
    const onError = vi.fn(async () => {
      throw new Error('handler fail')
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = new ErrorHandler({ sanitizer: sanitizer as any, onError })

    await handler.handle(new Error('boom'), new Request('http://example.com/'))

    expect(onError).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('adapts to Hono onError hook via toHonoHandler', async () => {
    const sanitizer = {
      shouldLog: vi.fn(() => false),
      sanitize: vi.fn(() => ({ message: 'safe', code: 'SAFE' })),
    }
    const handler = new ErrorHandler({ sanitizer: sanitizer as any })
    const honoHandler = handler.toHonoHandler()

    const raw = new Request('http://example.com/hono', { headers: { 'x-request-id': 'hono-1' } })
    const res = await honoHandler(new Error('fail'), { req: { raw } } as any)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.requestId).toBe('hono-1')
  })
})
