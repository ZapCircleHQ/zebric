# Zebric 0.1.2 - AI Tooling Readiness

**Release Date:** October 28, 2025
**Status:** ✅ Complete

---

## Overview

Version 0.1.2 makes Zebric a target for AI app building tools by providing comprehensive APIs for Blueprint generation, validation, and deployment.

AI tools can now generate token-efficient Blueprints (50-100 lines) instead of thousands of lines of code, with built-in validation and structured error handling.

---

## What's New

### JSON Schema for Blueprint

AI tools can now validate Blueprints before generation using the complete JSON Schema.

**Key Features:**
- Auto-generated from Zod schemas (single source of truth)
- Validates both TOML and JSON formats
- Includes field descriptions and examples
- 28KB comprehensive schema

**Usage:**
```typescript
import { getBlueprintJsonSchema } from '@zebric/runtime'

// Use with AI models (e.g., OpenAI function calling)
const schema = getBlueprintJsonSchema()
const completion = await openai.chat.completions.create({
  functions: [{ name: 'create_blueprint', parameters: schema }]
})
```

**Files:**
- `packages/runtime/schema/blueprint.schema.json`
- `packages/runtime/src/blueprint/json-schema.ts`

---

### Structured Error Messages

Validation errors are now machine-readable with actionable fix suggestions.

**Key Features:**
- Error codes: `INVALID_TYPE`, `REQUIRED_FIELD`, `UNKNOWN_REFERENCE`, etc.
- Line/column information for parse errors
- Expected vs received values
- Actionable suggestions for each error
- Both JSON and formatted string output

**Usage:**
```typescript
import { validateBlueprint } from '@zebric/runtime'

const result = await validateBlueprint('./blueprint.toml')

if (!result.valid) {
  result.errors?.forEach(error => {
    error.errors.forEach(detail => {
      console.log(`[${detail.code}] ${detail.message}`)
      console.log(`Location: ${detail.location.path.join('.')}`)
      console.log(`Expected: ${detail.expected}`)
      console.log(`Received: ${detail.received}`)
      console.log(`Suggestion: ${detail.suggestion}`)
    })
  })
}
```

**Files:**
- `packages/runtime/src/blueprint/validation-error.ts` (320 lines)

---

### Blueprint Validation API

Programmatic validation without starting the server.

**Key Features:**
- Multiple input formats (file, string, object)
- No server required
- Structured error output
- Helper functions for common cases

**Functions:**
- `validateBlueprint(path)` - Validate from file path
- `validateBlueprintContent(content, format)` - Validate from string
- `validateBlueprintData(data)` - Validate JavaScript object
- `isBlueprintValid(path)` - Simple boolean check
- `validateBlueprintOrThrow(path)` - Validate or throw

**Usage:**
```typescript
import { validateBlueprintContent } from '@zebric/runtime'

const toml = `
version = "1.0"
[project]
name = "AI Generated App"
...
`

const result = await validateBlueprintContent(toml, 'toml')

if (result.valid) {
  // Write to file and deploy
  await writeFile('./blueprint.toml', toml)
}
```

**Files:**
- `packages/runtime/src/blueprint/validate.ts` (271 lines)
- `packages/runtime/src/blueprint/validate.test.ts` (16 tests)

---

### Programmatic Runtime API

Control Zebric server lifecycle from code.

**Key Features:**
- Simple `start()`, `stop()`, `reload()` API
- Built-in validation
- Dev mode support (hot reload, admin server)
- Test-friendly helpers
- Type-safe with TypeScript

**Classes & Functions:**
- `Zebric` class - Main lifecycle control
- `createZebric(options)` - Create and start in one call
- `createTestZebric(path)` - For testing (in-memory DB, random port)

**Usage:**
```typescript
import { createZebric } from '@zebric/runtime'

// Start server
const zebric = await createZebric({
  blueprintPath: './blueprint.toml',
  port: 3000,
  dev: true
})

console.log('Running at:', zebric.getUrl())

// Reload with changes
await zebric.reload()

// Stop server
await zebric.stop()
```

**For Testing:**
```typescript
import { createTestZebric } from '@zebric/runtime'

const zebric = await createTestZebric('./test-blueprint.toml')

// Run tests
const response = await fetch(`${zebric.getUrl()}/api/users`)
expect(response.ok).toBe(true)

// Cleanup
await zebric.stop()
```

**Files:**
- `packages/runtime/src/programmatic.ts` (259 lines)
- `packages/runtime/src/programmatic.test.ts` (11 tests)

---

## Documentation

Three comprehensive guides for AI tool builders:

### 1. Building AI Tools with Zebric
**File:** `docs/ai-tools-guide.md`

**Contents:**
- Why Zebric for AI tools
- Quick start guide
- Validation workflow
- Blueprint generation strategies
- Testing & deployment
- Error handling patterns
- Complete working examples

### 2. API Reference
**File:** `docs/api-reference.md`

**Contents:**
- Complete function signatures
- Parameter descriptions
- Return types
- Code examples
- Type definitions
- Error handling

### 3. Blueprint Best Practices
**File:** `docs/blueprint-best-practices.md`

**Contents:**
- Generation strategies (incremental, bottom-up)
- Entity design patterns
- Page generation guidelines
- Validation patterns
- Common app patterns (blog, task manager)
- Anti-patterns to avoid

---

## Complete AI Tool Flow

Here's the end-to-end flow enabled by this release:

```typescript
import {
  validateBlueprintContent,
  createZebric,
  getBlueprintJsonSchema,
  type ValidationErrorDetail,
} from '@zebric/runtime'

async function generateAndDeployApp(userPrompt: string) {
  // 1. Get schema for AI validation
  const schema = getBlueprintJsonSchema()

  // 2. AI generates Blueprint
  const blueprint = await aiModel.generate(userPrompt, schema)

  // 3. Validate
  let result = await validateBlueprintContent(blueprint, 'toml')

  // 4. Auto-fix if needed
  if (!result.valid) {
    const errors = result.errors!.flatMap(e => e.errors)
    const fixed = await aiModel.fixErrors(blueprint, errors)
    result = await validateBlueprintContent(fixed, 'toml')

    if (!result.valid) {
      throw new Error('Could not fix validation errors')
    }
  }

  // 5. Write to file
  await writeFile('./blueprint.toml', blueprint)

  // 6. Test the app
  const testZebric = await createTestZebric('./blueprint.toml')
  const testResponse = await fetch(`${testZebric.getUrl()}/`)
  await testZebric.stop()

  if (!testResponse.ok) {
    throw new Error('Generated app failed tests')
  }

  // 7. Deploy to production
  const zebric = await createZebric({
    blueprintPath: './blueprint.toml',
    port: 3000,
    databaseUrl: process.env.DATABASE_URL,
    dev: false,
  })

  console.log('✅ App deployed at:', zebric.getUrl())

  return zebric
}
```

---

## Breaking Changes

**None** - All new APIs are additive. Existing code continues to work without changes.

---

## Testing

**Total Tests:** 304 (299 passing, 5 skipped)

**New Tests:**
- Blueprint validation: 16 tests
- Programmatic API: 11 tests
- All existing tests: Passing

**Test Coverage:**
- Validation API: ✅ Full coverage
- Programmatic API: ✅ Full coverage
- Error handling: ✅ Full coverage
- Integration tests: ✅ All passing

---

## Performance

**JSON Schema Generation:**
- Size: 28KB
- Generation time: ~100ms
- Auto-generated on build

**Validation Performance:**
- Small Blueprint (50 lines): ~5ms
- Large Blueprint (500 lines): ~15ms
- Validation is very fast for AI tool feedback loops

---

## Migration Guide

No migration needed - all changes are additive!

To use the new APIs, simply import them:

```typescript
// New imports available in 0.1.2
import {
  // Validation
  validateBlueprint,
  validateBlueprintContent,
  validateBlueprintData,
  isBlueprintValid,
  validateBlueprintOrThrow,

  // Runtime
  Zebric,
  createZebric,
  createTestZebric,

  // Schema
  getBlueprintJsonSchema,
  getBlueprintJsonSchemaString,
  BLUEPRINT_SCHEMA_PATH,

  // Errors
  BlueprintValidationError,
  type ValidationResult,
  type StructuredValidationError,
} from '@zebric/runtime'
```

---

## What's Next

### Version 0.1.3 - Feature Completeness
**Planned features:**
- Complete PostgreSQL support
- Entity relationships (one-to-many, many-to-many)
- File upload support with S3
- Search and filtering
- Better form validation
- Multi-instance deployment documentation

### Version 0.2.0 - Production Ready
**Planned features:**
- Stable Blueprint schema with backward compatibility
- Migration system
- MySQL support
- Advanced access control
- API-only mode
- BullMQ integration for workflows

---

## Resources

- **GitHub:** https://github.com/ZapCircleHQ/zebric
- **Documentation:** https://zebric.dev
- **Issues:** https://github.com/ZapCircleHQ/zebric/issues

---

## Feedback

We'd love to hear from you!

- Found a bug? [Open an issue](https://github.com/ZapCircleHQ/zebric/issues)
- Building an AI tool with Zebric? Share your experience!
- Have suggestions? We're listening!

---

**Zebric** - Runtime Engine for AI-Generated Applications

