import { describe, it, expect } from 'vitest'
import { InputValidator } from './input-validator.js'

describe('InputValidator', () => {
  describe('validate', () => {
    it('should pass valid data', () => {
      const errors = InputValidator.validate(
        { name: 'John', email: 'john@example.com' },
        {
          name: { required: true, type: 'string' },
          email: { required: true, type: 'email' },
        }
      )
      expect(errors).toHaveLength(0)
    })

    it('should catch missing required fields', () => {
      const errors = InputValidator.validate(
        { email: 'john@example.com' },
        {
          name: { required: true },
          email: { required: true },
        }
      )
      expect(errors).toHaveLength(1)
      expect(errors[0]?.field).toBe('name')
    })

    it('should allow optional missing fields', () => {
      const errors = InputValidator.validate(
        { name: 'John' },
        {
          name: { required: true },
          bio: { required: false, type: 'string' },
        }
      )
      expect(errors).toHaveLength(0)
    })
  })

  describe('type validation', () => {
    it('should validate string type', () => {
      const errors = InputValidator.validateField('name', 42, { type: 'string' })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('string')
    })

    it('should validate number type', () => {
      const errors = InputValidator.validateField('age', 'not-a-number', { type: 'number' })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('number')
    })

    it('should reject NaN for number type', () => {
      const errors = InputValidator.validateField('age', NaN, { type: 'number' })
      expect(errors).toHaveLength(1)
    })

    it('should validate boolean type', () => {
      const errors = InputValidator.validateField('active', 'yes', { type: 'boolean' })
      expect(errors).toHaveLength(1)
    })

    it('should validate email type', () => {
      expect(InputValidator.validateField('email', 'valid@example.com', { type: 'email' })).toHaveLength(0)
      expect(InputValidator.validateField('email', 'invalid-email', { type: 'email' })).toHaveLength(1)
      expect(InputValidator.validateField('email', '@no-local.com', { type: 'email' })).toHaveLength(1)
    })

    it('should validate url type', () => {
      expect(InputValidator.validateField('url', 'https://example.com', { type: 'url' })).toHaveLength(0)
      expect(InputValidator.validateField('url', 'not-a-url', { type: 'url' })).toHaveLength(1)
      expect(InputValidator.validateField('url', 'ftp://invalid.com', { type: 'url' })).toHaveLength(1)
    })

    it('should validate uuid type', () => {
      expect(InputValidator.validateField('id', '550e8400-e29b-41d4-a716-446655440000', { type: 'uuid' })).toHaveLength(0)
      expect(InputValidator.validateField('id', 'not-a-uuid', { type: 'uuid' })).toHaveLength(1)
    })

    it('should validate date type', () => {
      expect(InputValidator.validateField('date', '2024-01-15', { type: 'date' })).toHaveLength(0)
      expect(InputValidator.validateField('date', new Date(), { type: 'date' })).toHaveLength(0)
      expect(InputValidator.validateField('date', 'not-a-date', { type: 'date' })).toHaveLength(1)
    })
  })

  describe('string validations', () => {
    it('should enforce minLength', () => {
      const errors = InputValidator.validateField('name', 'ab', { minLength: 3 })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('at least 3')
    })

    it('should enforce maxLength', () => {
      const errors = InputValidator.validateField('name', 'toolongname', { maxLength: 5 })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('at most 5')
    })

    it('should detect XSS in string values', () => {
      const errors = InputValidator.validateField('input', '<script>alert(1)</script>', {})
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('malicious')
      expect(errors[0]?.value).toBe('[REDACTED]')
    })
  })

  describe('number validations', () => {
    it('should enforce min', () => {
      const errors = InputValidator.validateField('age', -1, { type: 'number', min: 0 })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('at least 0')
    })

    it('should enforce max', () => {
      const errors = InputValidator.validateField('age', 200, { type: 'number', max: 150 })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('at most 150')
    })
  })

  describe('pattern validation', () => {
    it('should validate against regex pattern', () => {
      const errors = InputValidator.validateField('code', 'abc', { pattern: /^[A-Z]{3}$/ })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('invalid format')
    })

    it('should pass matching patterns', () => {
      const errors = InputValidator.validateField('code', 'ABC', { pattern: /^[A-Z]{3}$/ })
      expect(errors).toHaveLength(0)
    })
  })

  describe('enum validation', () => {
    it('should accept valid enum values', () => {
      const errors = InputValidator.validateField('status', 'active', { enum: ['active', 'inactive'] })
      expect(errors).toHaveLength(0)
    })

    it('should reject invalid enum values', () => {
      const errors = InputValidator.validateField('status', 'unknown', { enum: ['active', 'inactive'] })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('must be one of')
    })
  })

  describe('custom validation', () => {
    it('should run custom validator returning true', () => {
      const errors = InputValidator.validateField('val', 10, {
        custom: (v) => v > 5
      })
      expect(errors).toHaveLength(0)
    })

    it('should run custom validator returning error string', () => {
      const errors = InputValidator.validateField('val', 3, {
        custom: (v) => v > 5 ? true : 'Must be greater than 5'
      })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toBe('Must be greater than 5')
    })
  })

  describe('sanitizeString', () => {
    it('should trim whitespace', () => {
      expect(InputValidator.sanitizeString('  hello  ')).toBe('hello')
    })

    it('should enforce maxLength', () => {
      expect(InputValidator.sanitizeString('hello world', { maxLength: 5 })).toBe('hello')
    })
  })

  describe('validateBodySize', () => {
    it('should pass small bodies', () => {
      expect(InputValidator.validateBodySize({ name: 'test' }, 1000)).toBeNull()
    })

    it('should reject oversized bodies', () => {
      const error = InputValidator.validateBodySize({ data: 'x'.repeat(1000) }, 100)
      expect(error).not.toBeNull()
      expect(error?.message).toContain('too large')
    })
  })
})
