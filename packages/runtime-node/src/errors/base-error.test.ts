import { describe, it, expect } from 'vitest'
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  BlueprintError,
  CacheError,
  ConflictError,
  DatabaseError,
  InternalServerError,
  NotFoundError,
  PluginError,
  RateLimitError,
  ValidationException,
  isOperationalError,
} from './base-error.js'

describe('base-error', () => {
  it('serializes app errors to JSON', () => {
    class TestError extends AppError {
      constructor() {
        super('test', 'TEST', 418, true, { a: 1 })
      }
    }

    const error = new TestError()
    expect(error.toJSON()).toEqual({
      name: 'TestError',
      message: 'test',
      code: 'TEST',
      statusCode: 418,
      context: { a: 1 },
    })
  })

  it('uses expected defaults for common errors', () => {
    expect(new ValidationException().statusCode).toBe(400)
    expect(new AuthenticationError().code).toBe('AUTHENTICATION_ERROR')
    expect(new AuthorizationError().statusCode).toBe(403)
    expect(new NotFoundError('User').message).toBe('User not found')
    expect(new ConflictError().statusCode).toBe(409)
    expect(new RateLimitError().statusCode).toBe(429)
    expect(new InternalServerError().isOperational).toBe(false)
    expect(new DatabaseError('db').code).toBe('DATABASE_ERROR')
    expect(new CacheError('cache').code).toBe('CACHE_ERROR')
    expect(new BlueprintError('bp').code).toBe('BLUEPRINT_ERROR')
    expect(new PluginError('plugin').code).toBe('PLUGIN_ERROR')
  })

  it('detects operational errors', () => {
    expect(isOperationalError(new ValidationException())).toBe(true)
    expect(isOperationalError(new InternalServerError())).toBe(false)
    expect(isOperationalError(new Error('plain'))).toBe(false)
  })
})
