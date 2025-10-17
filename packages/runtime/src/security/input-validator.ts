/**
 * Input Validation
 *
 * Comprehensive input validation to prevent injection attacks and malformed data.
 */

import { detectXss } from './html-escape.js'

export interface ValidationRule {
  required?: boolean
  type?: 'string' | 'number' | 'boolean' | 'email' | 'url' | 'uuid' | 'date'
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: RegExp
  enum?: string[]
  custom?: (value: any) => boolean | string
}

export interface ValidationError {
  field: string
  message: string
  value?: any
}

export class InputValidator {
  /**
   * Validate object against schema
   */
  static validate(
    data: Record<string, any>,
    schema: Record<string, ValidationRule>
  ): ValidationError[] {
    const errors: ValidationError[] = []

    for (const [field, rule] of Object.entries(schema)) {
      const value = data[field]
      const fieldErrors = this.validateField(field, value, rule)
      errors.push(...fieldErrors)
    }

    return errors
  }

  /**
   * Validate a single field
   */
  static validateField(
    field: string,
    value: any,
    rule: ValidationRule
  ): ValidationError[] {
    const errors: ValidationError[] = []

    // Required check
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field,
        message: `${field} is required`,
        value,
      })
      return errors // Stop validation if required and missing
    }

    // Skip other validations if not required and empty
    if (!rule.required && (value === undefined || value === null || value === '')) {
      return errors
    }

    // Type validation
    if (rule.type) {
      const typeError = this.validateType(field, value, rule.type)
      if (typeError) {
        errors.push(typeError)
        return errors // Stop if type is wrong
      }
    }

    // String validations
    if (typeof value === 'string') {
      if (rule.minLength && value.length < rule.minLength) {
        errors.push({
          field,
          message: `${field} must be at least ${rule.minLength} characters`,
          value,
        })
      }

      if (rule.maxLength && value.length > rule.maxLength) {
        errors.push({
          field,
          message: `${field} must be at most ${rule.maxLength} characters`,
          value,
        })
      }

      // XSS detection
      if (detectXss(value)) {
        errors.push({
          field,
          message: `${field} contains potentially malicious content`,
          value: '[REDACTED]',
        })
      }
    }

    // Number validations
    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        errors.push({
          field,
          message: `${field} must be at least ${rule.min}`,
          value,
        })
      }

      if (rule.max !== undefined && value > rule.max) {
        errors.push({
          field,
          message: `${field} must be at most ${rule.max}`,
          value,
        })
      }
    }

    // Pattern validation
    if (rule.pattern && typeof value === 'string') {
      if (!rule.pattern.test(value)) {
        errors.push({
          field,
          message: `${field} has invalid format`,
          value,
        })
      }
    }

    // Enum validation
    if (rule.enum) {
      if (!rule.enum.includes(String(value))) {
        errors.push({
          field,
          message: `${field} must be one of: ${rule.enum.join(', ')}`,
          value,
        })
      }
    }

    // Custom validation
    if (rule.custom) {
      const result = rule.custom(value)
      if (result !== true) {
        errors.push({
          field,
          message: typeof result === 'string' ? result : `${field} is invalid`,
          value,
        })
      }
    }

    return errors
  }

  /**
   * Validate type
   */
  private static validateType(
    field: string,
    value: any,
    type: string
  ): ValidationError | null {
    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          return { field, message: `${field} must be a string`, value }
        }
        break

      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          return { field, message: `${field} must be a number`, value }
        }
        break

      case 'boolean':
        if (typeof value !== 'boolean') {
          return { field, message: `${field} must be a boolean`, value }
        }
        break

      case 'email':
        if (typeof value !== 'string' || !this.isValidEmail(value)) {
          return { field, message: `${field} must be a valid email`, value }
        }
        break

      case 'url':
        if (typeof value !== 'string' || !this.isValidUrl(value)) {
          return { field, message: `${field} must be a valid URL`, value }
        }
        break

      case 'uuid':
        if (typeof value !== 'string' || !this.isValidUuid(value)) {
          return { field, message: `${field} must be a valid UUID`, value }
        }
        break

      case 'date':
        if (!this.isValidDate(value)) {
          return { field, message: `${field} must be a valid date`, value }
        }
        break
    }

    return null
  }

  /**
   * Email validation
   */
  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email) && email.length <= 254
  }

  /**
   * URL validation
   */
  private static isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol)
    } catch {
      return false
    }
  }

  /**
   * UUID validation
   */
  private static isValidUuid(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(uuid)
  }

  /**
   * Date validation
   */
  private static isValidDate(date: any): boolean {
    if (date instanceof Date) {
      return !isNaN(date.getTime())
    }

    if (typeof date === 'string' || typeof date === 'number') {
      const parsed = new Date(date)
      return !isNaN(parsed.getTime())
    }

    return false
  }

  /**
   * Sanitize string input (remove dangerous characters)
   */
  static sanitizeString(input: string, options: { maxLength?: number; allowedChars?: RegExp } = {}): string {
    let sanitized = input

    // Trim whitespace
    sanitized = sanitized.trim()

    // Apply max length
    if (options.maxLength) {
      sanitized = sanitized.substring(0, options.maxLength)
    }

    // Filter to allowed characters
    if (options.allowedChars) {
      sanitized = sanitized.replace(new RegExp(`[^${options.allowedChars.source}]`, 'g'), '')
    }

    return sanitized
  }

  /**
   * Validate request body size
   */
  static validateBodySize(body: any, maxSizeBytes: number): ValidationError | null {
    const size = JSON.stringify(body).length

    if (size > maxSizeBytes) {
      return {
        field: 'body',
        message: `Request body too large: ${size} bytes (max: ${maxSizeBytes})`,
      }
    }

    return null
  }
}
