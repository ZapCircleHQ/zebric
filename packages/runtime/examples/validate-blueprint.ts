/**
 * Example: Using the Blueprint Validation API
 *
 * This example shows how AI tools and CLI tools can validate
 * Blueprints programmatically without starting the Zebric server.
 */

import {
  validateBlueprint,
  validateBlueprintContent,
  validateBlueprintData,
  isBlueprintValid,
  validateBlueprintOrThrow,
  type ValidationResult,
} from '../src/blueprint/validate.js'
import { BlueprintValidationError } from '../src/blueprint/validation-error.js'

// Example 1: Validate a Blueprint file
async function example1() {
  console.log('\n=== Example 1: Validate Blueprint File ===\n')

  const result = await validateBlueprint('./blueprint.toml')

  if (result.valid) {
    console.log('✅ Blueprint is valid!')
    console.log(`   Project: ${result.blueprint?.project.name}`)
    console.log(`   Entities: ${result.blueprint?.entities.length}`)
    console.log(`   Pages: ${result.blueprint?.pages.length}`)
  } else {
    console.log('❌ Blueprint validation failed!')
    result.errors?.forEach((error) => {
      console.log(`\n   Error type: ${error.type}`)
      console.log(`   Message: ${error.message}`)
      error.errors.forEach((detail) => {
        console.log(`     - ${detail.message}`)
        if (detail.suggestion) {
          console.log(`       💡 ${detail.suggestion}`)
        }
      })
    })
  }
}

// Example 2: Validate Blueprint content (useful for AI-generated content)
async function example2() {
  console.log('\n=== Example 2: Validate AI-Generated Blueprint ===\n')

  const aiGeneratedToml = `
version = "1.0"

[project]
name = "AI Generated App"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "completed", type = "Boolean", default = false }
]

[page."/"]
title = "Tasks"
layout = "list"

[page."/".queries.tasks]
entity = "Task"
`

  const result = await validateBlueprintContent(aiGeneratedToml, 'toml')

  if (result.valid) {
    console.log('✅ AI-generated Blueprint is valid!')
    console.log(`   Ready to write to file and deploy`)
  } else {
    console.log('❌ AI-generated Blueprint has errors - fixing needed')
    // AI tool would parse these errors and regenerate
    console.log(JSON.stringify(result.errors, null, 2))
  }
}

// Example 3: Validate Blueprint data object
async function example3() {
  console.log('\n=== Example 3: Validate Blueprint Object ===\n')

  const blueprintData = {
    version: '1.0',
    project: {
      name: 'Programmatic App',
      version: '0.1.0',
      runtime: { min_version: '0.1.0' },
    },
    entities: [
      {
        name: 'User',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'email', type: 'Email', required: true },
        ],
      },
    ],
    pages: [
      {
        path: '/',
        title: 'Home',
        layout: 'list',
      },
    ],
  }

  const result = await validateBlueprintData(blueprintData)

  if (result.valid) {
    console.log('✅ Blueprint object is valid!')
  }
}

// Example 4: Simple boolean check
async function example4() {
  console.log('\n=== Example 4: Simple Validity Check ===\n')

  const isValid = await isBlueprintValid('./blueprint.toml')
  console.log(isValid ? '✅ Valid' : '❌ Invalid')
}

// Example 5: Validate or throw (for error handling)
async function example5() {
  console.log('\n=== Example 5: Validate with Exception Handling ===\n')

  try {
    const blueprint = await validateBlueprintOrThrow('./blueprint.toml')
    console.log(`✅ Validated: ${blueprint.project.name}`)
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      console.log('❌ Validation error:')
      console.log(error.toFormattedString())

      // Access structured error for programmatic handling
      const structured = error.structured
      console.log('\nStructured error (for AI tools):')
      console.log(JSON.stringify(structured, null, 2))
    }
  }
}

// Example 6: CI/CD validation
async function example6() {
  console.log('\n=== Example 6: CI/CD Pipeline Validation ===\n')

  const result = await validateBlueprint('./blueprint.toml')

  if (!result.valid) {
    console.error('Blueprint validation failed in CI/CD pipeline')
    result.errors?.forEach((error) => {
      console.error(`::error file=blueprint.toml::${error.message}`)
      error.errors.forEach((detail) => {
        const location = detail.location.path.join('.')
        console.error(`::error file=blueprint.toml,line=${detail.location.line ?? 0}::${location}: ${detail.message}`)
      })
    })
    process.exit(1)
  }

  console.log('✅ Blueprint validation passed')
}

// Example 7: AI tool with auto-fix suggestions
async function example7() {
  console.log('\n=== Example 7: AI Tool with Auto-Fix ===\n')

  const invalidToml = `
version = "1.0"

[project]
name = "My App"
# Missing version and runtime.min_version
`

  const result = await validateBlueprintContent(invalidToml, 'toml')

  if (!result.valid) {
    console.log('🔧 Analyzing errors and generating fixes...\n')

    result.errors?.[0].errors.forEach((error) => {
      console.log(`Error: ${error.message}`)
      console.log(`Code: ${error.code}`)
      console.log(`Location: ${error.location.path.join('.')}`)

      if (error.suggestion) {
        console.log(`Suggestion: ${error.suggestion}`)
      }

      // AI tool would use this structured information to:
      // 1. Identify the exact location of the error
      // 2. Understand what's expected vs what was received
      // 3. Apply the suggestion to generate a fix
      // 4. Re-validate the fixed Blueprint
    })
  }
}

// Run examples
async function main() {
  // Note: Some examples will fail if blueprint.toml doesn't exist
  // This is intentional to show error handling

  try {
    await example2() // Validate AI-generated content
    await example3() // Validate object
    await example7() // Auto-fix suggestions
  } catch (error) {
    console.error('Example error:', error)
  }
}

// Uncomment to run:
// main()

export {
  example1,
  example2,
  example3,
  example4,
  example5,
  example6,
  example7,
}
