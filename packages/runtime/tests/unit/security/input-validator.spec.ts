import { describe, it, expect } from 'vitest'
import { InputValidator } from '../../../src/security/input-validator.js'

describe('InputValidator', () => {
  describe('validate', () => {
    it('should validate required fields', () => {
      const data = { name: '' }
      const schema = { name: { required: true } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].field).toBe('name')
      expect(errors[0].message).toContain('required')
    })

    it('should pass validation with valid data', () => {
      const data = { name: 'John', age: 25 }
      const schema = {
        name: { required: true, type: 'string' },
        age: { required: true, type: 'number' }
      }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })

    it('should allow optional fields to be missing', () => {
      const data = { name: 'John' }
      const schema = {
        name: { required: true },
        age: { required: false }
      }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })
  })

  describe('type validation', () => {
    it('should validate string types', () => {
      const data = { name: 123 }
      const schema = { name: { type: 'string' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('string')
    })

    it('should validate number types', () => {
      const data = { age: 'not a number' }
      const schema = { age: { type: 'number' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('number')
    })

    it('should validate boolean types', () => {
      const data = { active: 'yes' }
      const schema = { active: { type: 'boolean' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('boolean')
    })

    it('should validate email format', () => {
      const invalidEmail = { email: 'not-an-email' }
      const schema = { email: { type: 'email' } }
      const errors = InputValidator.validate(invalidEmail, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('email')
    })

    it('should accept valid email', () => {
      const data = { email: 'test@example.com' }
      const schema = { email: { type: 'email' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })

    it('should validate URL format', () => {
      const data = { website: 'not-a-url' }
      const schema = { website: { type: 'url' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('URL')
    })

    it('should accept valid URLs', () => {
      const data = { website: 'https://example.com' }
      const schema = { website: { type: 'url' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })

    it('should validate UUID format', () => {
      const data = { id: 'not-a-uuid' }
      const schema = { id: { type: 'uuid' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
    })

    it('should accept valid UUID', () => {
      const data = { id: '550e8400-e29b-41d4-a716-446655440000' }
      const schema = { id: { type: 'uuid' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })
  })

  describe('string validation', () => {
    it('should enforce minLength', () => {
      const data = { name: 'ab' }
      const schema = { name: { minLength: 3 } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('at least 3')
    })

    it('should enforce maxLength', () => {
      const data = { name: 'verylongname' }
      const schema = { name: { maxLength: 5 } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('at most 5')
    })

    it('should validate pattern', () => {
      const data = { code: 'ABC123!' }
      const schema = { code: { pattern: /^[A-Z0-9]+$/ } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('invalid format')
    })

    it('should accept matching pattern', () => {
      const data = { code: 'ABC123' }
      const schema = { code: { pattern: /^[A-Z0-9]+$/ } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })
  })

  describe('number validation', () => {
    it('should enforce min value', () => {
      const data = { age: 5 }
      const schema = { age: { type: 'number', min: 18 } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('at least 18')
    })

    it('should enforce max value', () => {
      const data = { score: 150 }
      const schema = { score: { type: 'number', max: 100 } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('at most 100')
    })
  })

  describe('enum validation', () => {
    it('should validate enum values', () => {
      const data = { status: 'invalid' }
      const schema = { status: { enum: ['active', 'inactive', 'pending'] } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('one of')
    })

    it('should accept valid enum values', () => {
      const data = { status: 'active' }
      const schema = { status: { enum: ['active', 'inactive', 'pending'] } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })
  })

  describe('XSS detection', () => {
    it('should detect XSS in string inputs', () => {
      const data = { comment: '<script>alert("xss")</script>' }
      const schema = { comment: { type: 'string' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('malicious')
      expect(errors[0].value).toBe('[REDACTED]')
    })

    it('should allow safe HTML-like content', () => {
      const data = { comment: 'I said <hello> to them' }
      const schema = { comment: { type: 'string' } }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })
  })

  describe('custom validation', () => {
    it('should run custom validators', () => {
      const data = { password: 'weak' }
      const schema = {
        password: {
          custom: (value: string) => value.length >= 8 || 'Password too weak'
        }
      }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('Password too weak')
    })

    it('should pass custom validation', () => {
      const data = { password: 'StrongP@ss123' }
      const schema = {
        password: {
          custom: (value: string) => value.length >= 8
        }
      }
      const errors = InputValidator.validate(data, schema as any)

      expect(errors).toHaveLength(0)
    })
  })

  describe('validateBodySize', () => {
    it('should reject oversized bodies', () => {
      const largeBody = { data: 'x'.repeat(10000) }
      const error = InputValidator.validateBodySize(largeBody, 1000)

      expect(error).not.toBeNull()
      expect(error?.message).toContain('too large')
    })

    it('should accept normal-sized bodies', () => {
      const normalBody = { data: 'small data' }
      const error = InputValidator.validateBodySize(normalBody, 10000)

      expect(error).toBeNull()
    })
  })

  describe('sanitizeString', () => {
    it('should trim whitespace', () => {
      const result = InputValidator.sanitizeString('  hello  ')
      expect(result).toBe('hello')
    })

    it('should enforce max length', () => {
      const result = InputValidator.sanitizeString('verylongstring', { maxLength: 5 })
      expect(result).toBe('veryl')
    })

    it('should filter to allowed characters', () => {
      const result = InputValidator.sanitizeString('abc123!@#', {
        allowedChars: /a-z0-9/
      })
      expect(result).toBe('abc123')
    })
  })
})
