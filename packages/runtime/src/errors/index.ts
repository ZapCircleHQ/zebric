/**
 * Error Module
 *
 * Centralized error handling with custom error classes.
 */

export {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalServerError,
  DatabaseError,
  CacheError,
  BlueprintError,
  PluginError,
  isOperationalError,
  type ErrorContext,
} from './base-error.js'

export { ErrorHandler, asyncHandler, type ErrorHandlerOptions } from './error-handler.js'
