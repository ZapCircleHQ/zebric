/**
 * Structured Blueprint Validation Errors
 *
 * Provides parseable error messages for AI tools with:
 * - Error codes
 * - Line/column information
 * - Actionable fix suggestions
 * - Structured error objects
 */

import type { ZodError, ZodIssue } from 'zod'

export interface ValidationErrorLocation {
  line?: number
  column?: number
  path: string[] // Path to the field in the Blueprint (e.g., ["entities", 0, "name"])
}

export interface ValidationErrorDetail {
  code: string // Error code (e.g., "INVALID_TYPE", "REQUIRED_FIELD", "UNKNOWN_ENTITY")
  message: string // Human-readable error message
  location: ValidationErrorLocation
  expected?: string // What was expected (e.g., "string", "User entity reference")
  received?: string // What was received (e.g., "number", "UnknownEntity")
  suggestion?: string // Actionable fix suggestion
}

export interface StructuredValidationError {
  type: 'SCHEMA_VALIDATION' | 'REFERENCE_VALIDATION' | 'PARSE_ERROR' | 'VERSION_ERROR'
  message: string
  errors: ValidationErrorDetail[]
  file?: string
}

/**
 * Blueprint Validation Error with structured details
 */
export class BlueprintValidationError extends Error {
  public readonly structured: StructuredValidationError

  constructor(structured: StructuredValidationError) {
    const summary = `${structured.type}: ${structured.message}\n${structured.errors.map(e => `  - ${e.message} (${e.code})`).join('\n')}`
    super(summary)
    this.name = 'BlueprintValidationError'
    this.structured = structured
  }

  /**
   * Get the structured error for programmatic access
   */
  toJSON(): StructuredValidationError {
    return this.structured
  }

  /**
   * Get a formatted error message for display
   */
  toFormattedString(): string {
    const lines: string[] = []
    lines.push(`❌ ${this.structured.type}: ${this.structured.message}`)
    if (this.structured.file) {
      lines.push(`   File: ${this.structured.file}`)
    }
    lines.push('')

    for (const error of this.structured.errors) {
      const location = this.formatLocation(error.location)
      lines.push(`  ${location} ${error.message}`)

      if (error.expected && error.received) {
        lines.push(`    Expected: ${error.expected}`)
        lines.push(`    Received: ${error.received}`)
      }

      if (error.suggestion) {
        lines.push(`    💡 ${error.suggestion}`)
      }

      lines.push('')
    }

    return lines.join('\n')
  }

  private formatLocation(location: ValidationErrorLocation): string {
    const path = location.path.length > 0 ? location.path.join('.') : 'root'
    if (location.line !== undefined) {
      return `[${path}:${location.line}:${location.column ?? 0}]`
    }
    return `[${path}]`
  }
}

/**
 * Convert Zod errors to structured validation errors
 */
export function zodErrorToStructured(
  zodError: ZodError,
  file?: string
): StructuredValidationError {
  const errors: ValidationErrorDetail[] = zodError.issues.map(issue =>
    zodIssueToDetail(issue)
  )

  return {
    type: 'SCHEMA_VALIDATION',
    message: 'Blueprint schema validation failed',
    errors,
    file,
  }
}

/**
 * Convert a single Zod issue to a validation error detail
 */
function zodIssueToDetail(issue: ZodIssue): ValidationErrorDetail {
  const path = issue.path.map(String)
  const location: ValidationErrorLocation = { path }
  const pathLabel = path.length > 0 ? path.join('.') : 'root'
  const received = getReceivedType(issue)

  // Map Zod error codes to our error codes and suggestions
  switch (issue.code) {
    case 'invalid_type':
      return {
        code: 'INVALID_TYPE',
        message: `Invalid type at ${pathLabel}: expected ${issue.expected}, got ${received}`,
        location,
        expected: String(issue.expected),
        received,
        suggestion: `Change the value to a ${issue.expected}`,
      }

    case 'invalid_value':
      return {
        code: 'INVALID_VALUE',
        message: issue.message ?? `Invalid value at ${pathLabel}`,
        location,
        received,
        suggestion: `Use one of the allowed values for ${pathLabel}`,
      }

    case 'unrecognized_keys':
      return {
        code: 'UNRECOGNIZED_KEYS',
        message: `Unrecognized keys at ${pathLabel}: ${issue.keys?.join(', ')}`,
        location,
        received: issue.keys?.join(', '),
        suggestion: `Remove the unrecognized keys or check for typos`,
      }

    case 'invalid_union':
      return {
        code: 'INVALID_UNION',
        message: `Invalid value at ${pathLabel}: doesn't match any of the allowed types`,
        location,
        suggestion: `Check the Blueprint schema documentation for allowed values at this location`,
      }

    case 'too_small':
      if (issue.origin === 'array') {
        return {
          code: 'ARRAY_TOO_SMALL',
          message: `Array at ${pathLabel} must have at least ${issue.minimum} items`,
          location,
          expected: `At least ${issue.minimum} items`,
          suggestion: `Add more item(s) to the array`,
        }
      }
      return {
        code: 'VALUE_TOO_SMALL',
        message: `Value at ${pathLabel} is too small: minimum is ${issue.minimum}`,
        location,
        expected: `>= ${issue.minimum}`,
        suggestion: `Increase the value to at least ${issue.minimum}`,
      }

    case 'too_big':
      if (issue.origin === 'array') {
        return {
          code: 'ARRAY_TOO_BIG',
          message: `Array at ${pathLabel} must have at most ${issue.maximum} items`,
          location,
          expected: `At most ${issue.maximum} items`,
          suggestion: `Remove item(s) from the array`,
        }
      }
      return {
        code: 'VALUE_TOO_BIG',
        message: `Value at ${pathLabel} is too large: maximum is ${issue.maximum}`,
        location,
        expected: `<= ${issue.maximum}`,
        suggestion: `Decrease the value to at most ${issue.maximum}`,
      }

    case 'invalid_format':
      return {
        code: 'INVALID_STRING_FORMAT',
        message: issue.message ?? `Invalid string format at ${pathLabel}`,
        location,
        expected: `String matching ${issue.format} format`,
        suggestion: getStringFormatSuggestion(String(issue.format)),
      }

    case 'custom':
      return {
        code: 'CUSTOM_VALIDATION_FAILED',
        message: issue.message ?? `Custom validation failed at ${pathLabel}`,
        location,
        suggestion: `Check the specific validation requirements for this field`,
      }

    default:
      return {
        code: 'VALIDATION_ERROR',
        message: issue.message ?? `Validation failed at ${path.join('.')}`,
        location,
      }
  }
}

function getReceivedType(issue: ZodIssue): string {
  if ('input' in issue) {
    const input = issue.input
    if (input === null) return 'null'
    if (Array.isArray(input)) return 'array'
    return typeof input
  }
  return 'unknown'
}

/**
 * Get helpful suggestions for string format validation
 */
function getStringFormatSuggestion(validation: string): string {
  const suggestions: Record<string, string> = {
    email: 'Provide a valid email address (e.g., user@example.com)',
    url: 'Provide a valid URL (e.g., https://example.com)',
    uuid: 'Provide a valid UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)',
    cuid: 'Provide a valid CUID',
    regex: 'Ensure the string matches the required pattern',
    datetime: 'Provide a valid ISO 8601 datetime (e.g., 2025-10-25T12:00:00Z)',
  }
  return suggestions[validation] ?? `Ensure the string is a valid ${validation}`
}

/**
 * Create a reference validation error
 */
export function createReferenceError(
  errors: string[],
  file?: string
): BlueprintValidationError {
  const details: ValidationErrorDetail[] = errors.map(msg => {
    // Parse error messages to extract structured info
    const detail: ValidationErrorDetail = {
      code: 'UNKNOWN_REFERENCE',
      message: msg,
      location: { path: [] },
    }

    // Extract entity/page/workflow names from error messages
    if (msg.includes('unknown entity')) {
      const match = msg.match(/unknown entity "([^"]+)"/)
      if (match) {
        detail.received = match[1]
        detail.suggestion = `Define the entity "${match[1]}" in your Blueprint, or fix the reference`
      }
    }

    return detail
  })

  return new BlueprintValidationError({
    type: 'REFERENCE_VALIDATION',
    message: 'Blueprint reference validation failed',
    errors: details,
    file,
  })
}

/**
 * Create a parse error
 */
export function createParseError(
  message: string,
  file?: string,
  line?: number,
  column?: number
): BlueprintValidationError {
  return new BlueprintValidationError({
    type: 'PARSE_ERROR',
    message: 'Failed to parse Blueprint file',
    errors: [
      {
        code: 'PARSE_ERROR',
        message,
        location: { path: [], line, column },
        suggestion: 'Check for syntax errors in your TOML or JSON file',
      },
    ],
    file,
  })
}

/**
 * Create a version compatibility error
 */
export function createVersionError(
  requiredVersion: string,
  currentVersion: string,
  file?: string
): BlueprintValidationError {
  return new BlueprintValidationError({
    type: 'VERSION_ERROR',
    message: 'Blueprint version incompatibility',
    errors: [
      {
        code: 'VERSION_INCOMPATIBLE',
        message: `Blueprint requires runtime version ${requiredVersion} or higher`,
        location: { path: ['project', 'runtime', 'min_version'] },
        expected: `>= ${requiredVersion}`,
        received: currentVersion,
        suggestion: `Upgrade your Zebric runtime to version ${requiredVersion} or higher`,
      },
    ],
    file,
  })
}
