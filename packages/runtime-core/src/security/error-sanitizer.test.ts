import { describe, it, expect } from 'vitest'
import { ErrorSanitizer } from './error-sanitizer.js'

describe('ErrorSanitizer', () => {
  describe('production mode', () => {
    const sanitizer = new ErrorSanitizer(false)

    it('should return generic message for server errors', () => {
      const result = sanitizer.sanitize(new Error('Database connection failed at /usr/local/db.ts'))
      expect(result.statusCode).toBe(500)
      expect(result.message).toBe('Internal server error')
      expect(result.error).toBe('Server Error')
      expect(result.message).not.toContain('/usr/local')
    })

    it('should allow client error messages through (sanitized)', () => {
      const error = new Error('Validation failed: name is required')
      const result = sanitizer.sanitize(error)
      expect(result.statusCode).toBe(400)
      expect(result.message).toContain('Validation failed')
    })

    it('should map error messages to status codes', () => {
      expect(sanitizer.sanitize(new Error('Not found')).statusCode).toBe(404)
      expect(sanitizer.sanitize(new Error('Unauthorized access')).statusCode).toBe(401)
      expect(sanitizer.sanitize(new Error('Access denied')).statusCode).toBe(403)
      expect(sanitizer.sanitize(new Error('Conflict detected')).statusCode).toBe(409)
      expect(sanitizer.sanitize(new Error('Too many requests')).statusCode).toBe(429)
    })

    it('should use explicit statusCode property', () => {
      const error = Object.assign(new Error('custom'), { statusCode: 422 })
      expect(sanitizer.sanitize(error).statusCode).toBe(422)
    })

    it('should handle non-Error objects', () => {
      const result = sanitizer.sanitize('string error')
      expect(result.statusCode).toBe(500)
      expect(result.message).toBe('An error occurred')
    })

    it('should strip file paths from messages', () => {
      const error = new Error('Invalid config at /Users/dev/project/config.ts')
      const result = sanitizer.sanitize(error)
      expect(result.message).not.toContain('/Users/dev')
    })

    it('should strip SQL details', () => {
      const error = new Error('Invalid input: SQLITE_CONSTRAINT: UNIQUE constraint failed')
      const result = sanitizer.sanitize(error)
      expect(result.message).not.toContain('SQLITE_CONSTRAINT')
    })

    it('should strip connection strings', () => {
      const error = new Error('Invalid connection: postgres://user:pass@host:5432/db')
      const result = sanitizer.sanitize(error)
      expect(result.message).not.toContain('postgres://')
    })

    it('should strip API tokens', () => {
      const error = new Error('Invalid: Bearer sk_live_abcdef1234567890abcdef1234567890')
      const result = sanitizer.sanitize(error)
      expect(result.message).not.toContain('sk_live_')
    })

    it('should strip email addresses', () => {
      const error = new Error('Invalid user: admin@internal.corp')
      const result = sanitizer.sanitize(error)
      expect(result.message).not.toContain('admin@internal')
    })

    it('should strip IP addresses', () => {
      const error = new Error('Invalid connection from 192.168.1.100')
      const result = sanitizer.sanitize(error)
      expect(result.message).not.toContain('192.168.1.100')
    })
  })

  describe('development mode', () => {
    const sanitizer = new ErrorSanitizer(true)

    it('should include more error details', () => {
      const error = new Error('Something went wrong')
      const result = sanitizer.sanitize(error)
      expect(result.message).toBe('Something went wrong')
    })

    it('should include error name', () => {
      const error = new TypeError('Invalid type')
      const result = sanitizer.sanitize(error)
      expect(result.error).toBe('TypeError')
    })

    it('should include error code', () => {
      const error = Object.assign(new Error('fail'), { code: 'ENOENT' })
      const result = sanitizer.sanitize(error)
      expect(result.code).toBe('ENOENT')
    })

    it('should still sanitize sensitive patterns', () => {
      const error = new Error('Failed to connect to postgres://user:pass@host/db')
      const result = sanitizer.sanitize(error)
      expect(result.message).not.toContain('postgres://')
    })

    it('should handle non-Error objects', () => {
      const result = sanitizer.sanitize('string error')
      expect(result.message).toBe('string error')
      expect(result.statusCode).toBe(500)
    })
  })

  describe('shouldLog', () => {
    const sanitizer = new ErrorSanitizer()

    it('should log 5xx errors', () => {
      expect(sanitizer.shouldLog(new Error('Server failure'))).toBe(true)
    })

    it('should log 401 and 403 errors', () => {
      expect(sanitizer.shouldLog(new Error('Unauthorized'))).toBe(true)
      expect(sanitizer.shouldLog(new Error('Forbidden'))).toBe(true)
    })

    it('should log 429 errors', () => {
      expect(sanitizer.shouldLog(new Error('Too many requests'))).toBe(true)
    })

    it('should not log 404 errors', () => {
      expect(sanitizer.shouldLog(new Error('Not found'))).toBe(false)
    })

    it('should not log validation errors', () => {
      expect(sanitizer.shouldLog(new Error('Invalid input'))).toBe(false)
    })
  })

  describe('getLogDetails', () => {
    const sanitizer = new ErrorSanitizer()

    it('should return full error details for logging', () => {
      const error = new Error('Test error')
      const details = sanitizer.getLogDetails(error)
      expect(details.name).toBe('Error')
      expect(details.message).toBe('Test error')
      expect(details.stack).toBeDefined()
    })

    it('should handle non-Error objects', () => {
      const details = sanitizer.getLogDetails('string error')
      expect(details.error).toBe('string error')
    })
  })
})
