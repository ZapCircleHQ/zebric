/**
 * Error Sanitizer
 *
 * Sanitizes error messages to prevent information disclosure.
 * Prevents stack traces, file paths, and sensitive data from leaking to clients.
 */

export interface SanitizedError {
  error: string
  message: string
  code?: string
  statusCode: number
}

export class ErrorSanitizer {
  private isDevelopment: boolean

  constructor(isDevelopment = false) {
    this.isDevelopment = isDevelopment
  }

  /**
   * Sanitize error for client response
   */
  sanitize(error: unknown, defaultMessage = 'An error occurred'): SanitizedError {
    // In development, show more details (but still sanitized)
    if (this.isDevelopment) {
      return this.sanitizeForDevelopment(error, defaultMessage)
    }

    // In production, show minimal information
    return this.sanitizeForProduction(error, defaultMessage)
  }

  /**
   * Sanitize for production (minimal information)
   */
  private sanitizeForProduction(error: unknown, defaultMessage: string): SanitizedError {
    if (error instanceof Error) {
      // Map known error types to safe messages
      const statusCode = this.getStatusCode(error)
      const safeMessage = this.getSafeMessage(error, defaultMessage)

      return {
        error: this.getErrorType(statusCode),
        message: safeMessage,
        statusCode,
      }
    }

    return {
      error: 'Internal Server Error',
      message: defaultMessage,
      statusCode: 500,
    }
  }

  /**
   * Sanitize for development (more details, but still no sensitive data)
   */
  private sanitizeForDevelopment(error: unknown, defaultMessage: string): SanitizedError {
    if (error instanceof Error) {
      const statusCode = this.getStatusCode(error)
      let message = error.message || defaultMessage

      // Remove sensitive patterns even in development
      message = this.removeSensitivePatterns(message)

      return {
        error: error.name || this.getErrorType(statusCode),
        message,
        code: (error as any).code,
        statusCode,
      }
    }

    return {
      error: 'Error',
      message: String(error || defaultMessage),
      statusCode: 500,
    }
  }

  /**
   * Get HTTP status code from error
   */
  private getStatusCode(error: Error): number {
    const errorAny = error as any

    // Check for explicit status code
    if (errorAny.statusCode) {
      return errorAny.statusCode
    }

    if (errorAny.status) {
      return errorAny.status
    }

    // Map error messages to status codes
    const message = error.message.toLowerCase()

    if (message.includes('not found')) return 404
    if (message.includes('unauthorized') || message.includes('authentication')) return 401
    if (message.includes('forbidden') || message.includes('access denied')) return 403
    if (message.includes('invalid') || message.includes('validation')) return 400
    if (message.includes('conflict')) return 409
    if (message.includes('too many requests')) return 429

    return 500
  }

  /**
   * Get safe error message
   */
  private getSafeMessage(error: Error, defaultMessage: string): string {
    const statusCode = this.getStatusCode(error)

    // For known client errors, allow message through (but sanitized)
    if (statusCode >= 400 && statusCode < 500) {
      let message = error.message || defaultMessage

      // Remove sensitive patterns
      message = this.removeSensitivePatterns(message)

      // If message becomes empty after sanitization, use default
      if (!message.trim()) {
        return this.getDefaultMessage(statusCode)
      }

      return message
    }

    // For server errors, use generic message
    return this.getDefaultMessage(statusCode)
  }

  /**
   * Get default message for status code
   */
  private getDefaultMessage(statusCode: number): string {
    const messages: Record<number, string> = {
      400: 'Bad Request',
      401: 'Authentication required',
      403: 'Access denied',
      404: 'Not found',
      409: 'Conflict',
      429: 'Too many requests',
      500: 'Internal server error',
      503: 'Service unavailable',
    }

    return messages[statusCode] || 'An error occurred'
  }

  /**
   * Get error type name
   */
  private getErrorType(statusCode: number): string {
    if (statusCode >= 400 && statusCode < 500) {
      return 'Client Error'
    }

    if (statusCode >= 500) {
      return 'Server Error'
    }

    return 'Error'
  }

  /**
   * Remove sensitive patterns from error messages
   */
  private removeSensitivePatterns(message: string): string {
    // Remove file paths
    message = message.replace(/\/[^\s]+\.(ts|js|json)/g, '[PATH]')
    message = message.replace(/[A-Z]:\\[^\s]+/g, '[PATH]')

    // Remove SQL details
    message = message.replace(/SQL[^:]*:/gi, 'Database:')
    message = message.replace(/SQLITE_\w+/gi, 'DATABASE_ERROR')

    // Remove stack trace indicators
    message = message.replace(/at\s+\w+\s+\([^)]+\)/g, '')
    message = message.replace(/at\s+[^\s]+:\d+:\d+/g, '')

    // Remove connection strings
    message = message.replace(/(?:mongodb|postgres|mysql):\/\/[^\s]+/gi, '[CONNECTION]')

    // Remove API keys and tokens
    message = message.replace(/[a-f0-9]{32,}/gi, '[TOKEN]')
    message = message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [TOKEN]')

    // Remove email addresses
    message = message.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[EMAIL]')

    // Remove IP addresses
    message = message.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]')

    return message.trim()
  }

  /**
   * Check if error should be logged (vs just returned to client)
   */
  shouldLog(error: unknown): boolean {
    const statusCode = this.getStatusCode(error as Error)

    // Log all 5xx errors
    if (statusCode >= 500) {
      return true
    }

    // Log some 4xx errors (but not 404)
    if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
      return true
    }

    return false
  }

  /**
   * Get full error details for logging (not for client)
   */
  getLogDetails(error: unknown): Record<string, any> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...((error as any).cause && { cause: (error as any).cause }),
      }
    }

    return {
      error: String(error),
    }
  }
}
