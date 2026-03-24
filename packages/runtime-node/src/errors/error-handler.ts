/**
 * Error Handler
 *
 * Centralized error handling with request tracking and logging.
 */

import { AppError } from './base-error.js'
import { ErrorSanitizer } from '@zebric/runtime-core'
import type { Logger } from '@zebric/observability'
import type { Context } from 'hono'

export interface ErrorHandlerOptions {
  sanitizer: ErrorSanitizer
  logger?: Logger
  onError?: (error: Error, request: Request) => void | Promise<void>
}

export class ErrorHandler {
  constructor(private options: ErrorHandlerOptions) {}

  /**
   * Handle errors and produce a Response
   */
  async handle(error: Error, request: Request): Promise<Response> {
    const requestId = (request as any).requestId || request.headers.get('x-request-id') || 'unknown'
    const correlationId = (request as any).traceId || request.headers.get('x-correlation-id') || undefined

    // Log the error
    if (this.options.sanitizer.shouldLog(error)) {
      const logContext = {
        requestId,
        correlationId,
        method: request.method || (request as any).method,
        url: request.url || (request as any).url,
        error,
      }

      if (error instanceof AppError && error.context) {
        Object.assign(logContext, { errorContext: error.context })
      }

      if (this.options.logger) {
        this.options.logger.error('Request error', logContext)
      } else {
        console.error('Request error:', logContext)
      }
    }

    // Call custom error handler if provided
    if (this.options.onError) {
      try {
        await this.options.onError(error, request)
      } catch (err) {
        if (this.options.logger) {
          this.options.logger.error('Error in custom error handler', {
            requestId,
            correlationId,
            error: err,
          })
        } else {
          console.error('Error in custom error handler:', err)
        }
      }
    }

    // Get status code
    let statusCode = 500
    if (error instanceof AppError) {
      statusCode = error.statusCode
    } else if ('statusCode' in error && typeof error.statusCode === 'number') {
      statusCode = error.statusCode
    }

    // Sanitize error for response
    const sanitized = this.options.sanitizer.sanitize(error)

    // Send response
    return Response.json({
      error: {
        message: sanitized.message,
        code: error instanceof AppError ? error.code : sanitized.code || 'INTERNAL_ERROR',
        statusCode,
        requestId,
      },
    }, {
      status: statusCode,
      headers: { 'X-Request-ID': requestId }
    })
  }

  /**
   * Adapter for Hono's onError hook
   */
  toHonoHandler() {
    return async (error: Error, c: Context) => {
      return this.handle(error, c.req.raw)
    }
  }
}
