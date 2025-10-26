/**
 * Blueprint Validation API
 *
 * Programmatic validation of Blueprints without running the server.
 * Useful for AI tools, CLI tools, and pre-deployment validation.
 */

import { BlueprintLoader } from './loader.js'
import type { Blueprint } from '../types/index.js'
import type { StructuredValidationError } from './validation-error.js'
import { BlueprintValidationError } from './validation-error.js'

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  blueprint?: Blueprint
  errors?: StructuredValidationError[]
}

/**
 * Validation options
 */
export interface ValidateOptions {
  /**
   * Engine version to validate compatibility against
   * @default Latest version
   */
  engineVersion?: string

  /**
   * Skip reference validation (useful for partial validation)
   * @default false
   */
  skipReferenceValidation?: boolean

  /**
   * Skip version compatibility check
   * @default false
   */
  skipVersionCheck?: boolean
}

/**
 * Validate a Blueprint from a file path
 *
 * @param path - Path to the Blueprint file (TOML or JSON)
 * @param options - Validation options
 * @returns Validation result with Blueprint or errors
 *
 * @example
 * ```typescript
 * import { validateBlueprint } from '@zebric/runtime'
 *
 * const result = await validateBlueprint('./blueprint.toml')
 * if (result.valid) {
 *   console.log('Blueprint is valid!', result.blueprint)
 * } else {
 *   console.error('Validation errors:', result.errors)
 * }
 * ```
 */
export async function validateBlueprint(
  path: string,
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  const loader = new BlueprintLoader()

  try {
    const blueprint = await loader.load(path)

    // Version check (if not skipped)
    if (!options.skipVersionCheck) {
      const engineVersion = options.engineVersion ?? getCurrentEngineVersion()
      loader.validateVersion(blueprint, engineVersion, path)
    }

    return {
      valid: true,
      blueprint,
    }
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      return {
        valid: false,
        errors: [error.structured],
      }
    }

    // Wrap unexpected errors
    return {
      valid: false,
      errors: [
        {
          type: 'SCHEMA_VALIDATION',
          message: error instanceof Error ? error.message : 'Unknown error',
          errors: [
            {
              code: 'UNEXPECTED_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
              location: { path: [] },
            },
          ],
        },
      ],
    }
  }
}

/**
 * Validate Blueprint content (string)
 *
 * @param content - Blueprint content as string (TOML or JSON)
 * @param format - Format of the content ('toml' or 'json')
 * @param options - Validation options
 * @returns Validation result with Blueprint or errors
 *
 * @example
 * ```typescript
 * import { validateBlueprintContent } from '@zebric/runtime'
 *
 * const tomlContent = `
 * version = "1.0"
 * [project]
 * name = "My App"
 * `
 *
 * const result = await validateBlueprintContent(tomlContent, 'toml')
 * if (!result.valid) {
 *   result.errors?.forEach(err => {
 *     console.error(err.message)
 *     err.errors.forEach(detail => {
 *       console.error(`  - ${detail.message}`)
 *       if (detail.suggestion) {
 *         console.error(`    💡 ${detail.suggestion}`)
 *       }
 *     })
 *   })
 * }
 * ```
 */
export async function validateBlueprintContent(
  content: string,
  format: 'toml' | 'json',
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  // Write to a temporary file and validate
  const { writeFile, mkdtemp, rm } = await import('fs/promises')
  const { join } = await import('path')
  const { tmpdir } = await import('os')

  const tempDir = await mkdtemp(join(tmpdir(), 'zebric-validate-'))
  const tempFile = join(tempDir, `blueprint.${format}`)

  try {
    await writeFile(tempFile, content, 'utf-8')
    const result = await validateBlueprint(tempFile, options)
    return result
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

/**
 * Validate Blueprint object directly (already parsed)
 *
 * @param data - Blueprint data as JavaScript object
 * @param options - Validation options
 * @returns Validation result with Blueprint or errors
 *
 * @example
 * ```typescript
 * import { validateBlueprintData } from '@zebric/runtime'
 *
 * const blueprintData = {
 *   version: '1.0',
 *   project: {
 *     name: 'My App',
 *     version: '0.1.0',
 *     runtime: { min_version: '0.1.0' }
 *   },
 *   entities: [],
 *   pages: []
 * }
 *
 * const result = await validateBlueprintData(blueprintData)
 * ```
 */
export async function validateBlueprintData(
  data: unknown,
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  // Convert to JSON and validate
  const jsonContent = JSON.stringify(data, null, 2)
  return validateBlueprintContent(jsonContent, 'json', options)
}

/**
 * Get the current engine version
 */
function getCurrentEngineVersion(): string {
  // In production, this would read from package.json
  // For now, return a default version
  return '0.1.1'
}

/**
 * Check if a Blueprint is valid (convenience function)
 *
 * @param path - Path to the Blueprint file
 * @returns true if valid, false otherwise
 *
 * @example
 * ```typescript
 * import { isBlueprintValid } from '@zebric/runtime'
 *
 * if (await isBlueprintValid('./blueprint.toml')) {
 *   console.log('✅ Blueprint is valid')
 * } else {
 *   console.log('❌ Blueprint has errors')
 * }
 * ```
 */
export async function isBlueprintValid(
  path: string,
  options?: ValidateOptions
): Promise<boolean> {
  const result = await validateBlueprint(path, options)
  return result.valid
}

/**
 * Validate and throw on error (convenience function)
 *
 * @param path - Path to the Blueprint file
 * @param options - Validation options
 * @returns The validated Blueprint
 * @throws BlueprintValidationError if validation fails
 *
 * @example
 * ```typescript
 * import { validateBlueprintOrThrow } from '@zebric/runtime'
 *
 * try {
 *   const blueprint = await validateBlueprintOrThrow('./blueprint.toml')
 *   console.log('Valid blueprint:', blueprint.project.name)
 * } catch (error) {
 *   if (error instanceof BlueprintValidationError) {
 *     console.error(error.toFormattedString())
 *   }
 * }
 * ```
 */
export async function validateBlueprintOrThrow(
  path: string,
  options?: ValidateOptions
): Promise<Blueprint> {
  const result = await validateBlueprint(path, options)

  if (!result.valid) {
    const error = result.errors?.[0]
    if (error) {
      throw new BlueprintValidationError(error)
    }
    throw new Error('Blueprint validation failed')
  }

  return result.blueprint!
}
