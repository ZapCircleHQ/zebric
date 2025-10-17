/**
 * Base Error Classes
 *
 * Custom error hierarchy for better error handling and debugging.
 */

export interface ErrorContext {
  [key: string]: any
}

/**
 * Base application error class
 */
export abstract class AppError extends Error {
  public readonly code: string
  public readonly statusCode: number
  public readonly isOperational: boolean
  public readonly context?: ErrorContext

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: ErrorContext
  ) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)

    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    this.isOperational = isOperational
    this.context = context

    Error.captureStackTrace(this)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
    }
  }
}

/**
 * Validation Error - 400
 */
export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', context?: ErrorContext) {
    super(message, 'VALIDATION_ERROR', 400, true, context)
  }
}

/**
 * Authentication Error - 401
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context?: ErrorContext) {
    super(message, 'AUTHENTICATION_ERROR', 401, true, context)
  }
}

/**
 * Authorization Error - 403
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied', context?: ErrorContext) {
    super(message, 'AUTHORIZATION_ERROR', 403, true, context)
  }
}

/**
 * Not Found Error - 404
 */
export class NotFoundError extends AppError {
  constructor(resource: string, context?: ErrorContext) {
    super(`${resource} not found`, 'NOT_FOUND', 404, true, context)
  }
}

/**
 * Conflict Error - 409
 */
export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict', context?: ErrorContext) {
    super(message, 'CONFLICT', 409, true, context)
  }
}

/**
 * Rate Limit Error - 429
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests', context?: ErrorContext) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, true, context)
  }
}

/**
 * Internal Server Error - 500
 */
export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error', context?: ErrorContext) {
    super(message, 'INTERNAL_SERVER_ERROR', 500, false, context)
  }
}

/**
 * Database Error - 500
 */
export class DatabaseError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'DATABASE_ERROR', 500, false, context)
  }
}

/**
 * Cache Error - 500
 */
export class CacheError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'CACHE_ERROR', 500, false, context)
  }
}

/**
 * Blueprint Error - 500
 */
export class BlueprintError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'BLUEPRINT_ERROR', 500, false, context)
  }
}

/**
 * Plugin Error - 500
 */
export class PluginError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'PLUGIN_ERROR', 500, false, context)
  }
}

/**
 * Check if an error is an operational error (expected/handled)
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational
  }
  return false
}
