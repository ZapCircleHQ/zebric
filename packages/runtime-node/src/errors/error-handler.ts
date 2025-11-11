/**
 * Error Handler
 *
 * Centralized error handling with request tracking and logging.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from './base-error.js'
import { ErrorSanitizer } from '@zebric/runtime-core'

export interface ErrorHandlerOptions {
  sanitizer: ErrorSanitizer
  logger?: any
  onError?: (error: Error, request: FastifyRequest) => void | Promise<void>
}

/**
 * Centralized error handler for Fastify
 */
export class ErrorHandler {
  constructor(private options: ErrorHandlerOptions) {}

  /**
   * Handle errors in Fastify
   */
  async handle(
    error: Error | FastifyError,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const requestId = (request as any).id || 'unknown'

    // Log the error
    if (this.options.sanitizer.shouldLog(error)) {
      const logContext = {
        requestId,
        method: request.method,
        url: request.url,
        error: error.message,
        stack: error.stack,
      }

      if (error instanceof AppError && error.context) {
        Object.assign(logContext, { errorContext: error.context })
      }

      if (this.options.logger) {
        this.options.logger.error(logContext, 'Request error')
      } else {
        console.error('Request error:', logContext)
      }
    }

    // Call custom error handler if provided
    if (this.options.onError) {
      try {
        await this.options.onError(error, request)
      } catch (err) {
        console.error('Error in custom error handler:', err)
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
    reply.status(statusCode).send({
      error: {
        message: sanitized.message,
        code: error instanceof AppError ? error.code : sanitized.code || 'INTERNAL_ERROR',
        statusCode,
        requestId,
      },
    })
  }

  /**
   * Create Fastify error handler
   */
  toFastifyHandler() {
    return (error: Error | FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      return this.handle(error, request, reply)
    }
  }
}

/**
 * Wrap async route handlers to catch errors
 */
export function asyncHandler(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<any>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply)
    } catch (error) {
      throw error // Let Fastify error handler catch it
    }
  }
}
