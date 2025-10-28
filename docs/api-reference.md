# Zebric API Reference

Complete API reference for programmatic usage of Zebric.

## Table of Contents

- [Blueprint Validation](#blueprint-validation)
- [Programmatic Runtime](#programmatic-runtime)
- [JSON Schema](#json-schema)
- [Error Handling](#error-handling)
- [Type Definitions](#type-definitions)

## Blueprint Validation

### `validateBlueprint()`

Validate a Blueprint file.

```typescript
function validateBlueprint(
  path: string,
  options?: ValidateOptions
): Promise<ValidationResult>
```

**Parameters:**
- `path` (string) - Path to Blueprint file (TOML or JSON)
- `options` (ValidateOptions, optional) - Validation options

**Returns:** `Promise<ValidationResult>`

**Example:**
```typescript
import { validateBlueprint } from '@zebric/runtime'

const result = await validateBlueprint('./blueprint.toml')

if (result.valid) {
  console.log('Valid!', result.blueprint)
} else {
  console.error('Invalid:', result.errors)
}
```

---

### `validateBlueprintContent()`

Validate Blueprint content from a string.

```typescript
function validateBlueprintContent(
  content: string,
  format: 'toml' | 'json',
  options?: ValidateOptions
): Promise<ValidationResult>
```

**Parameters:**
- `content` (string) - Blueprint content
- `format` ('toml' | 'json') - Content format
- `options` (ValidateOptions, optional) - Validation options

**Returns:** `Promise<ValidationResult>`

**Example:**
```typescript
import { validateBlueprintContent } from '@zebric/runtime'

const toml = `
version = "1.0"
[project]
name = "My App"
...
`

const result = await validateBlueprintContent(toml, 'toml')
```

---

### `validateBlueprintData()`

Validate a Blueprint JavaScript object.

```typescript
function validateBlueprintData(
  data: unknown,
  options?: ValidateOptions
): Promise<ValidationResult>
```

**Parameters:**
- `data` (unknown) - Blueprint data object
- `options` (ValidateOptions, optional) - Validation options

**Returns:** `Promise<ValidationResult>`

**Example:**
```typescript
import { validateBlueprintData } from '@zebric/runtime'

const blueprint = {
  version: '1.0',
  project: { name: 'My App', version: '0.1.0', runtime: { min_version: '0.1.0' } },
  entities: [],
  pages: []
}

const result = await validateBlueprintData(blueprint)
```

---

### `isBlueprintValid()`

Simple boolean check for Blueprint validity.

```typescript
function isBlueprintValid(
  path: string,
  options?: ValidateOptions
): Promise<boolean>
```

**Parameters:**
- `path` (string) - Path to Blueprint file
- `options` (ValidateOptions, optional) - Validation options

**Returns:** `Promise<boolean>`

**Example:**
```typescript
import { isBlueprintValid } from '@zebric/runtime'

if (await isBlueprintValid('./blueprint.toml')) {
  console.log('Valid!')
}
```

---

### `validateBlueprintOrThrow()`

Validate and throw on error.

```typescript
function validateBlueprintOrThrow(
  path: string,
  options?: ValidateOptions
): Promise<Blueprint>
```

**Parameters:**
- `path` (string) - Path to Blueprint file
- `options` (ValidateOptions, optional) - Validation options

**Returns:** `Promise<Blueprint>` - Validated Blueprint

**Throws:** `BlueprintValidationError` if invalid

**Example:**
```typescript
import { validateBlueprintOrThrow } from '@zebric/runtime'

try {
  const blueprint = await validateBlueprintOrThrow('./blueprint.toml')
  console.log('Valid:', blueprint.project.name)
} catch (error) {
  console.error('Invalid:', error.toFormattedString())
}
```

## Programmatic Runtime

### `Zebric` Class

Main class for controlling Zebric server lifecycle.

#### Constructor

```typescript
new Zebric(options: ZebricOptions)
```

**Parameters:**
- `options` (ZebricOptions) - Configuration options

**Example:**
```typescript
import { Zebric } from '@zebric/runtime'

const zebric = new Zebric({
  blueprintPath: './blueprint.toml',
  port: 3000,
  dev: true
})
```

---

#### `start()`

Start the Zebric server.

```typescript
async start(): Promise<void>
```

**Throws:** Error if validation fails or server cannot start

**Example:**
```typescript
await zebric.start()
console.log('Server started at:', zebric.getUrl())
```

---

#### `stop()`

Stop the Zebric server.

```typescript
async stop(): Promise<void>
```

**Throws:** Error if server is not running

**Example:**
```typescript
await zebric.stop()
```

---

#### `reload()`

Reload the server with a new Blueprint.

```typescript
async reload(blueprint?: Blueprint): Promise<void>
```

**Parameters:**
- `blueprint` (Blueprint, optional) - New Blueprint object. If not provided, reloads from current file.

**Example:**
```typescript
// Reload from file
await zebric.reload()

// Reload with specific Blueprint
const newBlueprint = { /* ... */ }
await zebric.reload(newBlueprint)
```

---

#### `getUrl()`

Get the server URL.

```typescript
getUrl(): string
```

**Returns:** Server URL (e.g., "http://localhost:3000")

**Throws:** Error if server is not running

---

#### `getAdminUrl()`

Get the admin server URL (dev mode only).

```typescript
getAdminUrl(): string | null
```

**Returns:** Admin server URL or null if not in dev mode

---

#### `running()`

Check if the server is running.

```typescript
running(): boolean
```

**Returns:** true if running, false otherwise

---

#### `getEngine()`

Get the underlying ZebricEngine instance (advanced usage).

```typescript
getEngine(): ZebricEngine | undefined
```

**Returns:** ZebricEngine instance or undefined if not started

---

### `createZebric()`

Create and start a Zebric instance in one call.

```typescript
async function createZebric(options: ZebricOptions): Promise<Zebric>
```

**Parameters:**
- `options` (ZebricOptions) - Configuration options

**Returns:** Started Zebric instance

**Example:**
```typescript
import { createZebric } from '@zebric/runtime'

const zebric = await createZebric({
  blueprintPath: './blueprint.toml',
  port: 3000,
  dev: true
})

console.log('Running at:', zebric.getUrl())
```

---

### `createTestZebric()`

Create a Zebric instance for testing with in-memory database.

```typescript
async function createTestZebric(blueprintPath: string): Promise<Zebric>
```

**Parameters:**
- `blueprintPath` (string) - Path to Blueprint file

**Returns:** Started Zebric instance with random port and in-memory database

**Example:**
```typescript
import { createTestZebric } from '@zebric/runtime'

const zebric = await createTestZebric('./test-blueprint.toml')

// Run tests
const response = await fetch(`${zebric.getUrl()}/api/users`)

// Cleanup
await zebric.stop()
```

## JSON Schema

### `getBlueprintJsonSchema()`

Get the Blueprint JSON Schema as an object.

```typescript
function getBlueprintJsonSchema(): Record<string, any>
```

**Returns:** JSON Schema object

**Example:**
```typescript
import { getBlueprintJsonSchema } from '@zebric/runtime'

const schema = getBlueprintJsonSchema()
console.log(schema.$schema) // "http://json-schema.org/draft-07/schema#"
```

---

### `getBlueprintJsonSchemaString()`

Get the Blueprint JSON Schema as a string.

```typescript
function getBlueprintJsonSchemaString(): string
```

**Returns:** JSON Schema as JSON string

---

### `BLUEPRINT_SCHEMA_PATH`

Path to the Blueprint JSON Schema file.

```typescript
const BLUEPRINT_SCHEMA_PATH: string
```

**Example:**
```typescript
import { BLUEPRINT_SCHEMA_PATH } from '@zebric/runtime'
import { readFileSync } from 'fs'

const schema = readFileSync(BLUEPRINT_SCHEMA_PATH, 'utf-8')
```

## Error Handling

### `BlueprintValidationError`

Error class for Blueprint validation failures.

```typescript
class BlueprintValidationError extends Error {
  readonly structured: StructuredValidationError

  toJSON(): StructuredValidationError
  toFormattedString(): string
}
```

**Properties:**
- `structured` - Structured error data

**Methods:**
- `toJSON()` - Get structured error data
- `toFormattedString()` - Get formatted error string with suggestions

**Example:**
```typescript
import { BlueprintValidationError } from '@zebric/runtime'

try {
  await validateBlueprintOrThrow('./invalid.toml')
} catch (error) {
  if (error instanceof BlueprintValidationError) {
    // Machine-readable
    const structured = error.structured
    console.log(structured.type) // "SCHEMA_VALIDATION"
    console.log(structured.errors) // Array of error details

    // Human-readable
    console.log(error.toFormattedString())
  }
}
```

## Type Definitions

### `ValidationResult`

Result of Blueprint validation.

```typescript
interface ValidationResult {
  valid: boolean
  blueprint?: Blueprint
  errors?: StructuredValidationError[]
}
```

---

### `ValidateOptions`

Options for Blueprint validation.

```typescript
interface ValidateOptions {
  engineVersion?: string
  skipReferenceValidation?: boolean
  skipVersionCheck?: boolean
}
```

**Properties:**
- `engineVersion` - Engine version to validate against (default: current version)
- `skipReferenceValidation` - Skip entity reference checks (default: false)
- `skipVersionCheck` - Skip version compatibility check (default: false)

---

### `ZebricOptions`

Options for creating a Zebric instance.

```typescript
interface ZebricOptions {
  blueprintPath?: string
  host?: string
  port?: number
  databaseUrl?: string
  redisUrl?: string
  dev?: boolean
  theme?: Theme
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  validateBeforeStart?: boolean
}
```

**Properties:**
- `blueprintPath` - Path to Blueprint file (required)
- `host` - Server host (default: 'localhost')
- `port` - Server port (default: 3000, use 0 for random)
- `databaseUrl` - Database URL (default: 'sqlite://./data/app.db')
- `redisUrl` - Redis URL for caching
- `dev` - Enable development mode (default: false)
- `theme` - Custom theme
- `logLevel` - Log level (default: 'info')
- `validateBeforeStart` - Validate Blueprint before starting (default: true)

---

### `StructuredValidationError`

Structured error information.

```typescript
interface StructuredValidationError {
  type: 'SCHEMA_VALIDATION' | 'REFERENCE_VALIDATION' | 'PARSE_ERROR' | 'VERSION_ERROR'
  message: string
  errors: ValidationErrorDetail[]
  file?: string
}
```

---

### `ValidationErrorDetail`

Detailed error information.

```typescript
interface ValidationErrorDetail {
  code: string
  message: string
  location: ValidationErrorLocation
  expected?: string
  received?: string
  suggestion?: string
}
```

**Properties:**
- `code` - Error code (e.g., "INVALID_TYPE", "REQUIRED_FIELD")
- `message` - Human-readable error message
- `location` - Error location in Blueprint
- `expected` - Expected value/type
- `received` - Actual value/type
- `suggestion` - Actionable fix suggestion

---

### `ValidationErrorLocation`

Location of an error in the Blueprint.

```typescript
interface ValidationErrorLocation {
  path: string[]
  line?: number
  column?: number
}
```

**Properties:**
- `path` - Path to field (e.g., ["entities", 0, "name"])
- `line` - Line number (for TOML/JSON files)
- `column` - Column number (for TOML/JSON files)

---

### `Blueprint`

Complete Blueprint type definition.

```typescript
interface Blueprint {
  version: string
  hash?: string
  project: ProjectConfig
  entities: Entity[]
  pages: Page[]
  workflows?: Workflow[]
  auth?: AuthConfig
  plugins?: PluginConfig[]
  ui?: UIConfig
}
```

See [Blueprint Types](../packages/runtime/src/types/blueprint.ts) for complete type definitions.

## Examples

### Complete Validation Example

```typescript
import {
  validateBlueprint,
  BlueprintValidationError,
} from '@zebric/runtime'

async function validateAndFix(path: string) {
  const result = await validateBlueprint(path)

  if (!result.valid) {
    console.log('Validation errors found:')

    result.errors?.forEach((error) => {
      console.log(`\n${error.type}: ${error.message}`)

      error.errors.forEach((detail) => {
        console.log(`  [${detail.code}] ${detail.message}`)
        console.log(`  Location: ${detail.location.path.join('.')}`)

        if (detail.expected && detail.received) {
          console.log(`  Expected: ${detail.expected}`)
          console.log(`  Received: ${detail.received}`)
        }

        if (detail.suggestion) {
          console.log(`  💡 ${detail.suggestion}`)
        }
      })
    })

    return false
  }

  console.log('✅ Blueprint is valid!')
  return true
}
```

### Complete Runtime Example

```typescript
import { Zebric } from '@zebric/runtime'

async function deployApp() {
  const zebric = new Zebric({
    blueprintPath: './blueprint.toml',
    port: 3000,
    databaseUrl: process.env.DATABASE_URL,
    dev: process.env.NODE_ENV !== 'production',
    validateBeforeStart: true,
  })

  try {
    await zebric.start()
    console.log('🚀 App deployed at:', zebric.getUrl())

    if (zebric.getAdminUrl()) {
      console.log('📊 Admin at:', zebric.getAdminUrl())
    }

    // Keep server running
    process.on('SIGTERM', async () => {
      console.log('Shutting down...')
      await zebric.stop()
      process.exit(0)
    })
  } catch (error) {
    console.error('Failed to deploy:', error)
    process.exit(1)
  }
}

deployApp()
```

## See Also

- [Building AI Tools Guide](./ai-tools-guide.md)
- [Blueprint Best Practices](./blueprint-best-practices.md)
- [Blueprint Schema](../packages/runtime/schema/blueprint.schema.json)
