import type { Context, MiddlewareHandler } from 'hono'
import { createCorrelationId, createRequestId, resolveCorrelationId } from './ids.js'
import { createRequestLogger } from './scopes.js'
import type { Logger, RequestLoggingOptions } from './types.js'

export const HONO_LOGGER_KEY = 'logger'
export const HONO_CORRELATION_ID_KEY = 'correlationId'
export const HONO_REQUEST_ID_KEY = 'requestId'

function getPath(c: Context): string {
  const url = new URL(c.req.url)
  return url.pathname
}

export function createHonoLoggerMiddleware(
  logger: Logger,
  options: RequestLoggingOptions = {}
): MiddlewareHandler {
  const correlationHeaderName = options.correlationHeaderName ?? 'x-correlation-id'
  const requestIdHeaderName = options.requestIdHeaderName ?? 'x-request-id'
  const logStart = options.logStart ?? false
  const logEnd = options.logEnd ?? true
  const generateRequestId = options.generateRequestId ?? true

  return async (c, next) => {
    const correlationId = resolveCorrelationId(c.req.raw.headers, correlationHeaderName)
    const requestId = generateRequestId
      ? createRequestId()
      : c.req.header(requestIdHeaderName) ?? createRequestId()

    const requestLogger = createRequestLogger(logger, {
      correlationId,
      requestId,
      method: c.req.method,
      path: getPath(c),
    })

    c.set(HONO_CORRELATION_ID_KEY, correlationId)
    c.set(HONO_REQUEST_ID_KEY, requestId)
    c.set(HONO_LOGGER_KEY, requestLogger)
    c.header(correlationHeaderName, correlationId)
    c.header(requestIdHeaderName, requestId)

    if (logStart) {
      requestLogger.info('Request started')
    }

    try {
      await next()
      c.res.headers.set(correlationHeaderName, correlationId)
      c.res.headers.set(requestIdHeaderName, requestId)
      if (logEnd) {
        requestLogger.info('Request completed', {
          statusCode: c.res.status,
        })
      }
    } catch (error) {
      requestLogger.error('Request failed', {
        error,
      })
      throw error
    }
  }
}

export function getHonoLogger(c: Context): Logger | undefined {
  return c.get(HONO_LOGGER_KEY)
}

export function getHonoCorrelationId(c: Context): string | undefined {
  return c.get(HONO_CORRELATION_ID_KEY)
    ?? c.req.header('x-correlation-id')
    ?? undefined
}

export function getHonoRequestId(c: Context): string | undefined {
  return c.get(HONO_REQUEST_ID_KEY)
    ?? undefined
}
