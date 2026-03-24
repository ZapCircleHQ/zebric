import type { Context, MiddlewareHandler } from 'hono'
import { createCorrelationId, createRequestId, resolveCorrelationId } from './ids.js'
import { createRequestLogger } from './scopes.js'
import type { Logger, RequestLoggingOptions } from './types.js'

export const HONO_LOGGER_KEY = 'logger'

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

    Reflect.set(c.req.raw, 'correlationId', correlationId)
    Reflect.set(c.req.raw, 'requestId', requestId)
    c.set(HONO_LOGGER_KEY, requestLogger)
    c.header(correlationHeaderName, correlationId)
    c.header(requestIdHeaderName, requestId)

    if (logStart) {
      requestLogger.info('Request started')
    }

    try {
      await next()
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
