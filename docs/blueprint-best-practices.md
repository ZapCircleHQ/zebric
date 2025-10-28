# Blueprint Generation Best Practices for AI

Guidelines and patterns for AI tools generating Zebric Blueprints.

## Table of Contents

- [Generation Strategy](#generation-strategy)
- [Entity Design](#entity-design)
- [Page Generation](#page-generation)
- [Validation Patterns](#validation-patterns)
- [Common Patterns](#common-patterns)
- [Anti-Patterns](#anti-patterns)
- [Examples](#examples)

## Generation Strategy

### Incremental Generation

Generate Blueprints incrementally and validate at each step:

```
1. Project metadata → Validate
2. Entities → Validate
3. Pages → Validate
4. Auth (if needed) → Validate
5. Workflows (if needed) → Validate
6. Final validation
```

**Why?** Early validation catches errors when context is fresh and fixes are easier.

### Bottom-Up Approach

Start with data model, then build UI:

```typescript
// 1. First, generate entities (data model)
const entities = await generateEntities(userRequest)

// 2. Validate entities exist
await validateBlueprintData({ ...baseBlueprint, entities })

// 3. Then generate pages that reference entities
const pages = await generatePages(entities, userRequest)

// 4. Validate references
await validateBlueprintData({ ...baseBlueprint, entities, pages })
```

**Why?** Pages reference entities, so entities must be defined first.

## Entity Design

### Primary Keys

Always use ULID for primary keys (recommended over UUID):

```toml
[[entities]]
name = "User"

[[entities.fields]]
name = "id"
type = "ULID"
primary_key = true
```

**Why?**
- Sortable by creation time
- URL-safe
- Better database performance

### Required Fields

Mark critical fields as required:

```toml
[[entities.fields]]
name = "email"
type = "Email"
required = true
```

**When to use:**
- Identity fields (email, username)
- Critical business data (product price, order total)
- Fields needed for app to function

**When not to use:**
- Optional metadata (description, notes)
- Fields with sensible defaults

### Field Types

Choose the most specific type:

```toml
# ✅ Good - Specific types
[[entities.fields]]
name = "email"
type = "Email"  # Built-in validation

[[entities.fields]]
name = "status"
type = "Enum"
values = ["draft", "published", "archived"]

# ❌ Bad - Too generic
[[entities.fields]]
name = "email"
type = "Text"  # No validation

[[entities.fields]]
name = "status"
type = "Text"  # No constraints
```

### Enum Values

Use enums for fixed sets of values:

```toml
[[entities.fields]]
name = "priority"
type = "Enum"
values = ["low", "medium", "high", "urgent"]
```

**Best practices:**
- Use lowercase, kebab-case values
- Keep lists short (2-10 values)
- Order from least to most important
- Include "other" or "unknown" if appropriate

### Default Values

Provide sensible defaults:

```toml
[[entities.fields]]
name = "status"
type = "Enum"
values = ["draft", "published"]
default = "draft"

[[entities.fields]]
name = "created_at"
type = "DateTime"
# No default needed - auto-set on creation
```

**When to use:**
- Boolean fields (default = false)
- Status fields (default = initial state)
- Counters (default = 0)

### Relationships

Use descriptive relationship names:

```toml
# ✅ Good - Clear relationship names
[entities.relations]
author = { type = "belongsTo", entity = "User", foreign_key = "author_id" }
comments = { type = "hasMany", entity = "Comment" }
tags = { type = "manyToMany", entity = "Tag", through = "PostTag" }

# ❌ Bad - Generic names
[entities.relations]
user = { type = "belongsTo", entity = "User" }
items = { type = "hasMany", entity = "Comment" }
```

## Page Generation

### Page Paths

Use RESTful URL patterns:

```toml
# ✅ Good - RESTful patterns
[[pages]]
path = "/"
title = "Home"

[[pages]]
path = "/posts"
title = "All Posts"

[[pages]]
path = "/posts/:id"
title = "Post Details"

[[pages]]
path = "/posts/new"
title = "Create Post"

# ❌ Bad - Inconsistent patterns
[[pages]]
path = "/list-posts"

[[pages]]
path = "/post-detail"

[[pages]]
path = "/add-new-post"
```

### Layout Selection

Choose appropriate layouts:

```toml
# List layout - For collections
[[pages]]
path = "/posts"
layout = "list"

[pages.queries.posts]
entity = "Post"
orderBy = { created_at = "desc" }

# Detail layout - For single items
[[pages]]
path = "/posts/:id"
layout = "detail"

[pages.queries.post]
entity = "Post"
where = { id = "$params.id" }

# Form layout - For create/edit
[[pages]]
path = "/posts/new"
layout = "form"

[pages.form]
entity = "Post"
method = "create"
```

### Query Design

Design queries that match the page purpose:

```toml
# List page - Recent posts
[pages.queries.posts]
entity = "Post"
orderBy = { created_at = "desc" }
limit = 20

# Detail page - Single post with comments
[pages.queries.post]
entity = "Post"
where = { id = "$params.id" }
include = ["comments", "author"]

# User profile - User's posts
[pages.queries.user_posts]
entity = "Post"
where = { author_id = "$currentUser.id" }
orderBy = { created_at = "desc" }
```

### Form Fields

Generate forms with appropriate field types:

```toml
[[pages]]
path = "/posts/new"
layout = "form"

[pages.form]
entity = "Post"
method = "create"

[[pages.form.fields]]
name = "title"
type = "text"
label = "Post Title"
required = true
placeholder = "Enter a catchy title..."

[[pages.form.fields]]
name = "content"
type = "textarea"
label = "Content"
required = true
rows = 10

[[pages.form.fields]]
name = "status"
type = "select"
label = "Status"
options = ["draft", "published"]
default = "draft"

[pages.form.onSuccess]
redirect = "/posts"
message = "Post created successfully!"
```

## Validation Patterns

### Check References

Always validate that entity references exist:

```typescript
// Before generating pages
const entityNames = entities.map((e) => e.name)

// When generating a query
const query = {
  entity: 'Post', // Check: entityNames.includes('Post')
}

// When generating a relation
const relation = {
  entity: 'User', // Check: entityNames.includes('User')
}
```

### Validate After Each Step

```typescript
async function generateBlueprint(userRequest) {
  let blueprint = createBaseBlueprint()

  // Step 1: Entities
  blueprint.entities = await generateEntities(userRequest)
  await validateAndFix(blueprint)

  // Step 2: Pages
  blueprint.pages = await generatePages(blueprint.entities, userRequest)
  await validateAndFix(blueprint)

  // Step 3: Optional features
  if (needsAuth(userRequest)) {
    blueprint.auth = await generateAuth()
    await validateAndFix(blueprint)
  }

  return blueprint
}

async function validateAndFix(blueprint) {
  const result = await validateBlueprintData(blueprint)

  if (!result.valid) {
    // Auto-fix or regenerate
    blueprint = await fixErrors(blueprint, result.errors)

    // Validate again
    const retryResult = await validateBlueprintData(blueprint)
    if (!retryResult.valid) {
      throw new Error('Could not fix validation errors')
    }
  }

  return blueprint
}
```

## Common Patterns

### Blog Application

```toml
version = "1.0"

[project]
name = "Blog"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

# Entities
[[entities]]
name = "Post"

[[entities.fields]]
name = "id"
type = "ULID"
primary_key = true

[[entities.fields]]
name = "title"
type = "Text"
required = true

[[entities.fields]]
name = "content"
type = "LongText"
required = true

[[entities.fields]]
name = "status"
type = "Enum"
values = ["draft", "published"]
default = "draft"

[[entities.fields]]
name = "created_at"
type = "DateTime"

[entities.relations]
author = { type = "belongsTo", entity = "User" }
comments = { type = "hasMany", entity = "Comment" }

[[entities]]
name = "Comment"

[[entities.fields]]
name = "id"
type = "ULID"
primary_key = true

[[entities.fields]]
name = "content"
type = "Text"
required = true

[entities.relations]
post = { type = "belongsTo", entity = "Post" }
author = { type = "belongsTo", entity = "User" }

# Pages
[[pages]]
path = "/"
title = "Blog Posts"
layout = "list"

[pages.queries.posts]
entity = "Post"
where = { status = "published" }
orderBy = { created_at = "desc" }
include = ["author"]

[[pages]]
path = "/posts/:id"
title = "Post"
layout = "detail"

[pages.queries.post]
entity = "Post"
where = { id = "$params.id" }
include = ["author", "comments"]
```

### Task Manager

```toml
[[entities]]
name = "Task"

[[entities.fields]]
name = "id"
type = "ULID"
primary_key = true

[[entities.fields]]
name = "title"
type = "Text"
required = true

[[entities.fields]]
name = "description"
type = "LongText"

[[entities.fields]]
name = "status"
type = "Enum"
values = ["todo", "in_progress", "done"]
default = "todo"

[[entities.fields]]
name = "priority"
type = "Enum"
values = ["low", "medium", "high"]
default = "medium"

[[entities.fields]]
name = "due_date"
type = "Date"

[[pages]]
path = "/"
title = "My Tasks"
layout = "list"

[pages.queries.tasks]
entity = "Task"
where = { status = ["todo", "in_progress"] }
orderBy = { priority = "desc", due_date = "asc" }

[[pages]]
path = "/tasks/new"
title = "New Task"
layout = "form"

[pages.form]
entity = "Task"
method = "create"

[[pages.form.fields]]
name = "title"
type = "text"
required = true

[[pages.form.fields]]
name = "description"
type = "textarea"
rows = 5

[[pages.form.fields]]
name = "priority"
type = "select"
options = ["low", "medium", "high"]

[[pages.form.fields]]
name = "due_date"
type = "date"
```

## Anti-Patterns

### ❌ Don't: Generate Without Validation

```typescript
// Bad - Generate everything then validate once
const blueprint = {
  entities: await generateEntities(),
  pages: await generatePages(),
  auth: await generateAuth(),
}

const result = await validateBlueprintData(blueprint)
// Too late to fix easily!
```

### ❌ Don't: Use Generic Field Names

```toml
# Bad
[[entities.fields]]
name = "text1"
type = "Text"

[[entities.fields]]
name = "text2"
type = "Text"

# Good
[[entities.fields]]
name = "title"
type = "Text"

[[entities.fields]]
name = "description"
type = "Text"
```

### ❌ Don't: Ignore Entity References

```toml
# Bad - References non-existent entity
[pages.queries.posts]
entity = "BlogPost"  # Entity is actually named "Post"

# Good - Validate entity exists
[pages.queries.posts]
entity = "Post"  # Matches defined entity
```

### ❌ Don't: Over-complicate Simple Apps

```toml
# Bad - Too many entities for a simple app
[[entities]]
name = "UserProfile"

[[entities]]
name = "UserSettings"

[[entities]]
name = "UserPreferences"

# Good - Combine related data
[[entities]]
name = "User"

[[entities.fields]]
# Include profile, settings, preferences as fields
```

### ❌ Don't: Skip Required Fields

```toml
# Bad - Missing required fields
[[entities.fields]]
name = "email"
type = "Email"
# Should be required = true

# Good
[[entities.fields]]
name = "email"
type = "Email"
required = true
```

## Examples

### Complete Generation Function

```typescript
import { validateBlueprintData, type Blueprint, type Entity } from '@zebric/runtime'

async function generateBlueprintFromPrompt(prompt: string): Promise<string> {
  // 1. Parse user intent
  const intent = await parseIntent(prompt)

  // 2. Create base Blueprint
  let blueprint: Blueprint = {
    version: '1.0',
    project: {
      name: intent.appName,
      version: '0.1.0',
      runtime: { min_version: '0.1.0' },
    },
    entities: [],
    pages: [],
  }

  // 3. Generate entities
  blueprint.entities = await generateEntities(intent)

  // Validate entities
  let result = await validateBlueprintData(blueprint)
  if (!result.valid) {
    throw new Error(`Entity validation failed: ${formatErrors(result.errors)}`)
  }

  // 4. Generate pages
  const entityNames = blueprint.entities.map((e) => e.name)
  blueprint.pages = await generatePages(intent, entityNames)

  // Validate pages
  result = await validateBlueprintData(blueprint)
  if (!result.valid) {
    throw new Error(`Page validation failed: ${formatErrors(result.errors)}`)
  }

  // 5. Add auth if needed
  if (intent.features.includes('auth')) {
    blueprint.auth = {
      providers: ['email'],
    }
  }

  // 6. Final validation
  result = await validateBlueprintData(blueprint)
  if (!result.valid) {
    throw new Error(`Final validation failed: ${formatErrors(result.errors)}`)
  }

  // 7. Convert to TOML
  return blueprintToTOML(blueprint)
}

function formatErrors(errors: any[]) {
  return errors
    ?.flatMap((err) => err.errors.map((e: any) => e.message))
    .join(', ')
}
```

## Testing Generated Blueprints

Always test generated Blueprints:

```typescript
import { createTestZebric } from '@zebric/runtime'

async function testGeneratedBlueprint(blueprintPath: string) {
  const zebric = await createTestZebric(blueprintPath)

  try {
    // Test homepage
    const homeResponse = await fetch(`${zebric.getUrl()}/`)
    if (!homeResponse.ok) {
      throw new Error('Homepage failed')
    }

    // Test API endpoints
    const entities = parseEntitiesFromBlueprint(blueprintPath)
    for (const entity of entities) {
      const apiResponse = await fetch(`${zebric.getUrl()}/api/${entity.name.toLowerCase()}s`)
      if (!apiResponse.ok) {
        throw new Error(`API for ${entity.name} failed`)
      }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error }
  } finally {
    await zebric.stop()
  }
}
```

## Resources

- [AI Tools Guide](./ai-tools-guide.md)
- [API Reference](./api-reference.md)
- [Blueprint Schema](../packages/runtime/schema/blueprint.schema.json)
- [Example Blueprints](../examples/)

## Summary

**Key Takeaways:**

1. ✅ **Generate incrementally** - Entities first, then pages
2. ✅ **Validate early** - After each generation step
3. ✅ **Use specific types** - Email, Enum, DateTime over generic Text
4. ✅ **Check references** - Ensure entities exist before referencing
5. ✅ **Provide defaults** - Make apps work out of the box
6. ✅ **Test generated apps** - Always validate the final result works
7. ✅ **Use ULID for IDs** - Better than UUID for most cases
8. ✅ **Follow REST patterns** - Standard URL structures

Following these practices will result in high-quality, production-ready Zebric applications.
