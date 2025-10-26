/**
 * JSON Schema for Blueprint validation
 *
 * Provides access to the JSON Schema that can be used by AI tools
 * and validation libraries to validate Blueprint configurations.
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Path to the Blueprint JSON Schema file
 */
export const BLUEPRINT_SCHEMA_PATH = join(__dirname, '../../schema/blueprint.schema.json')

/**
 * Get the Blueprint JSON Schema as an object
 */
export function getBlueprintJsonSchema(): Record<string, any> {
  const schemaContent = readFileSync(BLUEPRINT_SCHEMA_PATH, 'utf-8')
  return JSON.parse(schemaContent)
}

/**
 * Get the Blueprint JSON Schema as a string
 */
export function getBlueprintJsonSchemaString(): string {
  return readFileSync(BLUEPRINT_SCHEMA_PATH, 'utf-8')
}
