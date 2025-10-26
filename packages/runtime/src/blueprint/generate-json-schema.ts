/**
 * Generate JSON Schema from Zod Blueprint Schema
 *
 * This script generates a JSON Schema that can be used by AI tools
 * to validate Blueprints before code generation.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import { BlueprintSchema } from './schema.js'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Generate JSON Schema from Zod schema
const jsonSchema = zodToJsonSchema(BlueprintSchema, {
  name: 'Blueprint',
  $refStrategy: 'none', // Inline all definitions for simplicity
  target: 'jsonSchema7',
  definitions: {},
  strictUnions: true,
  errorMessages: true,
})

// Add metadata
const schemaWithMetadata = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://zebric.dev/schemas/blueprint.json',
  title: 'Zebric Blueprint Schema',
  description: 'Schema for validating Zebric Blueprint configurations in both JSON and TOML formats',
  ...jsonSchema,
}

// Write to file
const outputPath = join(__dirname, '../../schema/blueprint.schema.json')
writeFileSync(outputPath, JSON.stringify(schemaWithMetadata, null, 2), 'utf-8')

console.log(`✅ JSON Schema generated at: ${outputPath}`)
console.log(`   This schema can be used to validate both JSON and TOML Blueprints`)
