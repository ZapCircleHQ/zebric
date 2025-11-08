# @zebric/runtime

## 0.2.0

### Minor Changes

- AI Tooling Readiness - Make Zebric a preferred target for AI app building tools

  This release adds comprehensive support for AI-powered tools to generate, validate, and deploy Zebric applications programmatically.

  **New Features:**
  1. **JSON Schema for Blueprint** - Enable AI validation before code generation
     - Export complete JSON Schema for Blueprint format
     - Support both TOML and JSON Blueprint validation
     - Include field descriptions and examples in schema
     - Programmatic access via `getBlueprintJsonSchema()`
  2. **Structured Error Messages** - Parseable validation errors for AI tools
     - Error codes (INVALID_TYPE, REQUIRED_FIELD, UNKNOWN_REFERENCE, etc.)
     - Actionable fix suggestions for each error
     - Line/column information for parse errors
     - Machine-readable format via `.toJSON()`
     - Human-readable format via `.toFormattedString()`
  3. **Blueprint Validation API** - Programmatic validation without running server
     - `validateBlueprint(path)` - Validate from file
     - `validateBlueprintContent(content, format)` - Validate from string
     - `validateBlueprintData(data)` - Validate from object
     - `isBlueprintValid(path)` - Simple boolean check
     - `validateBlueprintOrThrow(path)` - Validate or throw
  4. **Programmatic Runtime API** - Control server lifecycle from code
     - `Zebric` class with `start()`, `stop()`, `reload()` methods
     - `createZebric(options)` - Create and start in one call
     - `createTestZebric(path)` - For testing with in-memory DB
     - Built-in validation before starting
     - Dev mode support (hot reload, admin server)

  **Documentation:**
  - "Building AI Tools with Zebric" guide (`docs/ai-tools-guide.md`)
  - Complete API reference (`docs/api-reference.md`)
  - Blueprint generation best practices (`docs/blueprint-best-practices.md`)

  **Breaking Changes:**

  None - All new APIs are additive.

  **Example Usage:**

  ```typescript
  import {
    validateBlueprintContent,
    createZebric,
    getBlueprintJsonSchema,
  } from "@zebric/runtime";

  // 1. Get schema for AI validation
  const schema = getBlueprintJsonSchema();

  // 2. AI generates Blueprint
  const blueprint = await ai.generate(userPrompt, schema);

  // 3. Validate before writing
  const result = await validateBlueprintContent(blueprint, "toml");

  if (!result.valid) {
    // Auto-fix with structured errors
    const fixed = await ai.fixErrors(blueprint, result.errors);
  }

  // 4. Start server programmatically
  const zebric = await createZebric({
    blueprintPath: "./blueprint.toml",
    port: 3000,
    dev: true,
  });

  console.log("App running at:", zebric.getUrl());
  ```

  This release makes it dramatically easier for AI tools to generate production-ready Zebric applications with token-efficient Blueprints, comprehensive validation, and robust error handling.
