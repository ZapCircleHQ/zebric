# Zebric Blueprint JSON Schema

This directory contains the JSON Schema definition for Zebric Blueprint configurations.

## What is this?

The `blueprint.schema.json` file is a [JSON Schema](https://json-schema.org/) that describes the complete structure of a Zebric Blueprint. This schema can be used by:

- **AI code generation tools** to validate Blueprints before generation
- **IDEs** for autocomplete and validation
- **Validation libraries** to ensure Blueprint correctness
- **Documentation tools** to generate reference docs

## Usage

### Using in AI Tools

AI tools can use this schema to validate generated Blueprints:

```typescript
import Ajv from 'ajv'
import { getBlueprintJsonSchema } from '@zebric/runtime'

const ajv = new Ajv()
const schema = getBlueprintJsonSchema()
const validate = ajv.compile(schema)

const isValid = validate(blueprintData)
if (!isValid) {
  console.error('Validation errors:', validate.errors)
}
```

### Using with JSON Files

Reference this schema in your Blueprint JSON files for IDE support:

```json
{
  "$schema": "https://zebric.dev/schemas/blueprint.json",
  "version": "1.0",
  "project": {
    "name": "my-app",
    "version": "0.1.0",
    "runtime": {
      "min_version": "0.1.0"
    }
  },
  "entities": [],
  "pages": []
}
```

### Using with TOML Files

While TOML files cannot reference schemas directly, you can convert TOML to JSON and validate:

```typescript
import { BlueprintLoader } from '@zebric/runtime'
import { getBlueprintJsonSchema } from '@zebric/runtime'

// Load TOML and convert to JSON internally
const blueprint = await BlueprintLoader.load('blueprint.toml')

// The loader already validates using Zod, but you can also validate
// against the JSON Schema if needed for additional tooling
```

### Accessing the Schema

The schema can be accessed in multiple ways:

```typescript
// Import the schema path
import { BLUEPRINT_SCHEMA_PATH } from '@zebric/runtime'

// Or get the schema as an object
import { getBlueprintJsonSchema } from '@zebric/runtime'
const schema = getBlueprintJsonSchema()

// Or get the schema as a string
import { getBlueprintJsonSchemaString } from '@zebric/runtime'
const schemaStr = getBlueprintJsonSchemaString()

// Or import directly
import schema from '@zebric/runtime/schema'
```

## Validation Guarantees

This schema is automatically generated from Zebric's internal [Zod](https://zod.dev/) schemas, which means:

- ✅ **Single source of truth** - Both TOML and JSON validation use the same underlying schema
- ✅ **Always in sync** - The JSON Schema is regenerated on every build
- ✅ **Type-safe** - TypeScript types, Zod schemas, and JSON Schema all match
- ✅ **Comprehensive** - Covers all Blueprint features including entities, pages, workflows, auth, plugins, and UI config

## Schema Features

The Blueprint schema includes:

### Core Configuration
- **Project metadata** - name, version, description, runtime requirements
- **Version tracking** - Blueprint version and hash

### Entities
- **13 field types** - ULID, UUID, Text, LongText, Email, Integer, Float, Boolean, DateTime, Date, JSON, Enum, Ref
- **Relations** - hasMany, hasOne, belongsTo, manyToMany
- **Access control** - Row-level and field-level permissions
- **Indexes** - Single and composite indexes

### Pages
- **Layouts** - list, detail, form, and custom layouts
- **Queries** - Entity queries with filtering, sorting, pagination
- **Forms** - Create, update, delete forms with validation
- **Authentication** - required, optional, none
- **Metadata** - SEO tags, OpenGraph images
- **Behaviors** - AI-generated custom behaviors

### Workflows
- **Triggers** - Entity events (create, update, delete)
- **Steps** - email, webhook, plugin, delay, condition

### Authentication
- **Providers** - OAuth, email/password, etc.
- **Session** configuration - duration, idle timeout
- **Permissions** - Role-based and conditional permissions

### Plugins
- **Configuration** - Plugin-specific settings
- **Trust levels** - limited (sandboxed) or full (with capabilities)
- **Capabilities** - database, network, storage, filesystem

### UI Configuration
- **Render modes** - server, hybrid, spa
- **Progressive enhancement** - Alpine.js or htmx
- **Theming** - Tailwind config, custom CSS
- **Custom components** - Custom layouts and components

## Regenerating the Schema

The schema is automatically regenerated during the build process:

```bash
pnpm build
```

Or manually:

```bash
pnpm generate-schema
```

## Related Documentation

- [Blueprint Reference](https://docs.zebric.dev/blueprint) - Complete Blueprint documentation
- [Building AI Tools with Zebric](https://docs.zebric.dev/ai-tools) - Guide for AI tool builders
- [Blueprint Validation API](https://docs.zebric.dev/api/validation) - Programmatic validation
