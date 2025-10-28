# Building AI Tools with Zebric

This guide shows you how to build AI-powered tools that generate, validate, and deploy Zebric applications.

## Table of Contents

- [Overview](#overview)
- [Why Zebric for AI Tools](#why-zebric-for-ai-tools)
- [Quick Start](#quick-start)
- [Validation Workflow](#validation-workflow)
- [Blueprint Generation](#blueprint-generation)
- [Testing & Deployment](#testing--deployment)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Complete Example](#complete-example)

## Overview

Zebric is designed to be a **preferred target for AI app builders** because:

1. **Token-efficient output** - Declarative Blueprints instead of thousands of lines of code
2. **JSON Schema validation** - Validate before generation
3. **Structured errors** - Machine-readable with fix suggestions
4. **Programmatic API** - Full control of server lifecycle
5. **Production-ready** - Built-in auth, database, and deployment

## Why Zebric for AI Tools

### Traditional Code Generation
```
AI Tool → Generates 1000s of lines of code → Hard to validate → Brittle
```

### Zebric Blueprint Generation
```
AI Tool → Generates 50-line Blueprint → Validates with JSON Schema → Robust
```

**Benefits:**
- **10-100x less output** - Blueprints are concise
- **Immediate validation** - Catch errors before writing files
- **Self-contained** - Everything in one Blueprint file
- **Production-capable** - Built-in security and best practices

## Quick Start

### Installation

```bash
npm install @zebric/runtime
```

### Basic AI Tool Flow

```typescript
import {
  validateBlueprintContent,
  createZebric,
  type Blueprint,
} from '@zebric/runtime'

// 1. AI generates Blueprint (TOML or JSON)
const aiGeneratedBlueprint = `
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

// 2. Validate the Blueprint
const result = await validateBlueprintContent(aiGeneratedBlueprint, 'toml')

if (!result.valid) {
  console.error('Validation errors:', result.errors)
  // Parse errors and regenerate
  process.exit(1)
}

// 3. Write to file
await writeFile('./blueprint.toml', aiGeneratedBlueprint)

// 4. Start the server
const zebric = await createZebric({
  blueprintPath: './blueprint.toml',
  port: 3000,
  dev: true,
})

console.log('App running at:', zebric.getUrl())
```

## Validation Workflow

### Using JSON Schema

The JSON Schema is perfect for AI tools that need to validate **before** generating code:

```typescript
import { getBlueprintJsonSchema } from '@zebric/runtime'

// Get the schema for your AI model
const schema = getBlueprintJsonSchema()

// Use with your AI tool (e.g., OpenAI's function calling)
const completion = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    {
      role: 'user',
      content: 'Create a task management app',
    },
  ],
  functions: [
    {
      name: 'create_blueprint',
      description: 'Create a Zebric Blueprint',
      parameters: schema,
    },
  ],
})
```

### Programmatic Validation

For validation after generation:

```typescript
import { validateBlueprint, validateBlueprintData } from '@zebric/runtime'

// From file
const result = await validateBlueprint('./blueprint.toml')

// From string content
const result = await validateBlueprintContent(tomlString, 'toml')

// From JavaScript object
const result = await validateBlueprintData(blueprintObject)

// All return the same structure:
if (!result.valid) {
  result.errors?.forEach((error) => {
    console.log(`Error type: ${error.type}`)
    error.errors.forEach((detail) => {
      console.log(`  - ${detail.message}`)
      console.log(`    Code: ${detail.code}`)
      console.log(`    Location: ${detail.location.path.join('.')}`)
      if (detail.suggestion) {
        console.log(`    Suggestion: ${detail.suggestion}`)
      }
    })
  })
}
```

## Blueprint Generation

### Recommended Approach

Use a multi-step generation approach:

#### Step 1: Generate Schema First

```typescript
// AI generates just the entity schema
const entities = await aiTool.generateEntities(userRequest)

const blueprint = {
  version: '1.0',
  project: {
    name: extractAppName(userRequest),
    version: '0.1.0',
    runtime: { min_version: '0.1.0' },
  },
  entities: entities,
  pages: [],
}

// Validate entities
const result = await validateBlueprintData(blueprint)
```

#### Step 2: Generate Pages

```typescript
// Now generate pages based on validated entities
const pages = await aiTool.generatePages(blueprint.entities, userRequest)
blueprint.pages = pages

// Validate again
const result = await validateBlueprintData(blueprint)
```

#### Step 3: Add Optional Features

```typescript
// Add auth, workflows, etc. based on user needs
if (userRequest.includes('auth')) {
  blueprint.auth = await aiTool.generateAuth()
}

if (userRequest.includes('workflow')) {
  blueprint.workflows = await aiTool.generateWorkflows()
}

// Final validation
const result = await validateBlueprintData(blueprint)
```

### Field Types Reference

When generating entities, use these field types:

```typescript
const fieldTypes = {
  // IDs
  ULID: 'Primary key (recommended)',
  UUID: 'Alternative primary key',

  // Text
  Text: 'Short text (255 chars)',
  LongText: 'Long text (unlimited)',
  Email: 'Email with validation',

  // Numbers
  Integer: 'Whole numbers',
  Float: 'Decimal numbers',

  // Other
  Boolean: 'true/false',
  DateTime: 'Date and time',
  Date: 'Date only',
  JSON: 'JSON data',
  Enum: 'Fixed set of values',
  Ref: 'Reference to another entity',
}
```

### Page Layouts

```typescript
const layouts = {
  list: 'Display multiple records',
  detail: 'Display single record',
  form: 'Create/update record',
  // Custom layouts are also supported
}
```

## Testing & Deployment

### Integration Testing

```typescript
import { createTestZebric } from '@zebric/runtime'

describe('AI Generated App', () => {
  it('should create and list tasks', async () => {
    // Start test server
    const zebric = await createTestZebric('./blueprint.toml')

    // Test the API
    const response = await fetch(`${zebric.getUrl()}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Task',
        completed: false,
      }),
    })

    expect(response.ok).toBe(true)

    // Cleanup
    await zebric.stop()
  })
})
```

### Deployment

```typescript
// After validation, deploy to production
const zebric = new Zebric({
  blueprintPath: './blueprint.toml',
  port: 3000,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  dev: false, // Production mode
})

await zebric.start()
```

## Error Handling

### Handling Validation Errors

```typescript
import { BlueprintValidationError } from '@zebric/runtime'

try {
  const result = await validateBlueprint('./blueprint.toml')

  if (!result.valid) {
    // Structure for AI to parse and fix
    const fixableErrors = result.errors?.flatMap((err) =>
      err.errors.map((detail) => ({
        code: detail.code,
        message: detail.message,
        location: detail.location.path.join('.'),
        expected: detail.expected,
        received: detail.received,
        suggestion: detail.suggestion,
      }))
    )

    // Send back to AI for regeneration
    const fixed = await aiTool.fixErrors(blueprint, fixableErrors)
    return fixed
  }
} catch (error) {
  if (error instanceof BlueprintValidationError) {
    // Access structured errors
    const structured = error.structured
    console.log(error.toFormattedString())
  }
}
```

### Common Error Codes

```typescript
const errorCodeHandling = {
  INVALID_TYPE: 'Wrong type - check expected vs received',
  INVALID_ENUM_VALUE: 'Use one of the allowed values',
  REQUIRED_FIELD: 'Add missing required field',
  UNKNOWN_REFERENCE: 'Entity/field reference not found',
  PARSE_ERROR: 'TOML/JSON syntax error',
}
```

### Auto-Fix Pattern

```typescript
async function autoFixBlueprint(
  blueprint: string,
  errors: ValidationError[]
): Promise<string> {
  for (const error of errors) {
    switch (error.code) {
      case 'REQUIRED_FIELD':
        // Add missing field
        blueprint = addRequiredField(blueprint, error.location, error.expected)
        break

      case 'INVALID_ENUM_VALUE':
        // Fix to first allowed value
        blueprint = fixEnumValue(
          blueprint,
          error.location,
          error.expected?.split(',')[0]
        )
        break

      case 'UNKNOWN_REFERENCE':
        // Extract entity name and add it
        const entityName = error.received
        blueprint = addMissingEntity(blueprint, entityName)
        break
    }
  }

  return blueprint
}
```

## Best Practices

### 1. Validate Early and Often

```typescript
// Validate after each generation step
const steps = ['entities', 'pages', 'auth', 'workflows']

for (const step of steps) {
  blueprint[step] = await generate(step)

  const result = await validateBlueprintData(blueprint)
  if (!result.valid) {
    // Fix before continuing
    blueprint = await fixErrors(blueprint, result.errors)
  }
}
```

### 2. Use TypeScript Types

```typescript
import type { Blueprint, Entity, Page } from '@zebric/runtime'

function generateEntity(name: string): Entity {
  return {
    name,
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      // TypeScript ensures correct structure
    ],
  }
}
```

### 3. Provide Context to AI

```typescript
// Instead of: "Create a blog app"
// Provide structured context:

const context = {
  appType: 'blog',
  entities: ['Post', 'Comment', 'User'],
  features: ['auth', 'crud', 'search'],
  deployment: 'production',
}

const blueprint = await aiTool.generate(context)
```

### 4. Version Your Blueprints

```typescript
const blueprint = {
  version: '1.0', // Blueprint format version
  project: {
    name: 'My App',
    version: '0.1.0', // App version (semantic versioning)
    runtime: {
      min_version: '0.1.0', // Minimum Zebric version
    },
  },
  // ...
}
```

### 5. Test Generated Apps

```typescript
// Always test generated apps before deployment
async function testGeneratedApp(blueprintPath: string) {
  const zebric = await createTestZebric(blueprintPath)

  try {
    // Test basic functionality
    const response = await fetch(`${zebric.getUrl()}/`)
    expect(response.ok).toBe(true)

    // Test API endpoints
    // ...

    return { success: true }
  } catch (error) {
    return { success: false, error }
  } finally {
    await zebric.stop()
  }
}
```

## Complete Example

Here's a complete AI tool that generates, validates, and deploys a Zebric app:

```typescript
import {
  validateBlueprintData,
  createZebric,
  type Blueprint,
} from '@zebric/runtime'
import { writeFile } from 'fs/promises'

class ZebricAITool {
  async generateApp(userPrompt: string): Promise<string> {
    // 1. Extract requirements
    const requirements = await this.parseRequirements(userPrompt)

    // 2. Generate Blueprint incrementally
    let blueprint: Blueprint = {
      version: '1.0',
      project: {
        name: requirements.appName,
        version: '0.1.0',
        runtime: { min_version: '0.1.0' },
      },
      entities: [],
      pages: [],
    }

    // 3. Generate entities
    blueprint.entities = await this.generateEntities(requirements)

    // 4. Validate entities
    let result = await validateBlueprintData(blueprint)
    if (!result.valid) {
      blueprint = await this.fixErrors(blueprint, result.errors!)
      result = await validateBlueprintData(blueprint)
    }

    // 5. Generate pages
    blueprint.pages = await this.generatePages(blueprint.entities, requirements)

    // 6. Add optional features
    if (requirements.needsAuth) {
      blueprint.auth = await this.generateAuth()
    }

    // 7. Final validation
    result = await validateBlueprintData(blueprint)
    if (!result.valid) {
      throw new Error(`Final validation failed: ${JSON.stringify(result.errors)}`)
    }

    // 8. Convert to TOML
    const toml = this.convertToTOML(blueprint)

    // 9. Write to file
    await writeFile('./blueprint.toml', toml)

    // 10. Test the app
    const testResult = await this.testApp('./blueprint.toml')
    if (!testResult.success) {
      throw new Error(`App test failed: ${testResult.error}`)
    }

    return toml
  }

  private async testApp(blueprintPath: string) {
    const zebric = await createTestZebric(blueprintPath)

    try {
      const response = await fetch(`${zebric.getUrl()}/`)
      return { success: response.ok }
    } catch (error) {
      return { success: false, error }
    } finally {
      await zebric.stop()
    }
  }

  // Implement other methods...
}

// Usage
const aiTool = new ZebricAITool()
const blueprint = await aiTool.generateApp(
  'Create a task management app with user authentication'
)

console.log('Generated Blueprint:', blueprint)

// Deploy
const zebric = await createZebric({
  blueprintPath: './blueprint.toml',
  port: 3000,
  dev: true,
})

console.log('App deployed at:', zebric.getUrl())
```

## Resources

- [Blueprint JSON Schema](../packages/runtime/schema/blueprint.schema.json)
- [API Reference](./api-reference.md)
- [Blueprint Best Practices](./blueprint-best-practices.md)
- [Example Blueprints](../examples/)

## Support

- GitHub Issues: https://github.com/ZapCircleHQ/zebric/issues
- Documentation: https://docs.zebric.dev

---

**Next Steps:**
1. Review the [API Reference](./api-reference.md) for detailed function signatures
2. Check [Blueprint Best Practices](./blueprint-best-practices.md) for generation tips
3. Explore [Example Apps](../examples/) for reference implementations
