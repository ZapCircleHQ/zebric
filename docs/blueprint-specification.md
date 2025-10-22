# Blueprint Specification

Version: 0.1.0

## Overview

A Blueprint is a TOML or JSON configuration file that defines the structure and behavior of a Zebric application. It includes entities (data models), pages, authentication, access control, and UI configuration.

## File Structure

```toml
version = "0.1.0"

[project]
name = "My Application"
version = "1.0.0"
description = "Optional description"

[project.runtime]
min_version = "0.1.0"

[entity.EntityName]
# Entity definition

[page."/path"]
# Page definition

[auth]
# Authentication configuration
```

## Project Configuration

### `[project]`

Required project metadata.

**Fields:**
- `name` (string, required): Application name
- `version` (string, required): Application version (semver)
- `description` (string, optional): Application description

### `[project.runtime]`

Runtime requirements.

**Fields:**
- `min_version` (string, required): Minimum Zebric Runtime version required

## Entities

Entities define data models and database schemas.

### `[entity.EntityName]`

Define an entity with fields, relations, and access control.

**Example:**
```toml
[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", unique = true, required = true },
  { name = "name", type = "Text", required = true },
  { name = "role", type = "Enum", values = ["user", "admin"], default = "user" },
  { name = "salary", type = "Integer", access = { read = { "$currentUser.role" = "admin" } } }
]
```

### Field Types

Supported field types:
- `ULID`: Universally Unique Lexicographically Sortable Identifier
- `UUID`: UUID v4
- `Text`: Short text (VARCHAR)
- `LongText`: Long text (TEXT)
- `Email`: Email address with validation
- `Integer`: 64-bit integer
- `Float`: Double precision floating point
- `Boolean`: True/false
- `DateTime`: ISO 8601 timestamp
- `Date`: ISO 8601 date
- `JSON`: JSON object
- `Enum`: Enumerated values
- `Ref`: Foreign key reference

### Field Attributes

**Common Attributes:**
- `name` (string, required): Field name
- `type` (FieldType, required): Field type
- `primary_key` (boolean): Mark as primary key
- `unique` (boolean): Enforce uniqueness
- `index` (boolean): Create database index
- `required` (boolean): Field cannot be null
- `nullable` (boolean): Explicitly allow null
- `default` (any): Default value

**Type-Specific Attributes:**
- `values` (string[]): For Enum type - list of allowed values
- `ref` (string): For Ref type - reference to another entity field (e.g., "User.id")

### Field-Level Access Control

Fields can have access control rules that determine who can read or write them.

**Syntax:**
```toml
{
  name = "fieldName",
  type = "Type",
  access = {
    read = <condition>,
    write = <condition>
  }
}
```

**Access Actions:**
- `read`: Control who can view this field's value
- `write`: Control who can modify this field's value (create or update)

**Examples:**

```toml
# Admin-only field
{
  name = "salary",
  type = "Integer",
  access = {
    read = { "$currentUser.role" = "admin" },
    write = { "$currentUser.role" = "admin" }
  }
}

# Read-only field (system-managed)
{
  name = "createdAt",
  type = "DateTime",
  access = {
    write = false  # No one can write (system sets this)
  }
}

# Self-readable field
{
  name = "privateNotes",
  type = "LongText",
  access = {
    read = { "authorId" = "$currentUser.id" }
  }
}

# Public read, restricted write
{
  name = "status",
  type = "Enum",
  values = ["draft", "published", "archived"],
  access = {
    write = { or = [
      { "authorId" = "$currentUser.id" },
      { "$currentUser.role" = "admin" }
    ]}
  }
}
```

### Relations

Define relationships between entities.

**Syntax:**
```toml
[entity.Post.relations]
author = { type = "belongsTo", entity = "User", foreign_key = "authorId" }
comments = { type = "hasMany", entity = "Comment", foreign_key = "postId" }
```

**Relation Types:**
- `belongsTo`: Many-to-one relationship
- `hasOne`: One-to-one relationship
- `hasMany`: One-to-many relationship
- `manyToMany`: Many-to-many relationship (requires `through` table)

### Entity-Level Access Control

Control who can perform CRUD operations on entire entities.

**Syntax:**
```toml
[entity.Post.access]
read = <condition>
create = <condition>
update = <condition>
delete = <condition>
```

**Access Conditions:**

1. **Boolean:** Simple allow/deny
   ```toml
   read = true   # Anyone can read
   create = true # Anyone can create
   delete = false # No one can delete
   ```

2. **Field Comparison:** Match field values
   ```toml
   update = { authorId = "$currentUser.id" }  # Only author can update
   ```

3. **OR Conditions:** Match any condition
   ```toml
   update = { or = [
     { authorId = "$currentUser.id" },
     { "$currentUser.role" = "admin" }
   ]}
   ```

4. **AND Conditions:** Match all conditions
   ```toml
   delete = { and = [
     { status = "draft" },
     { authorId = "$currentUser.id" }
   ]}
   ```

**Session Variables:**
- `$currentUser.id`: Current user's ID
- `$currentUser.{field}`: Any field from the user's session data (e.g., `$currentUser.role`, `$currentUser.email`)

### Indexes

Define database indexes for performance.

```toml
[entity.Post]
fields = [...]

[[entity.Post.indexes]]
fields = ["authorId", "status"]
name = "idx_author_status"

[[entity.Post.indexes]]
fields = ["email"]
unique = true
```

## Pages

Pages define routes, layouts, queries, and forms.

### `[page."/path"]`

Define a page with its route, layout, and data.

**Attributes:**
- `title` (string, required): Page title
- `auth` (string): Authentication requirement - `"required"`, `"optional"`, `"none"`
- `layout` (string, required): Layout type - `"list"`, `"detail"`, `"form"`, or custom

**Example:**
```toml
[page."/posts"]
title = "All Posts"
auth = "optional"
layout = "list"

[page."/posts".queries.posts]
entity = "Post"
where = { status = "published" }
orderBy = { createdAt = "desc" }
limit = 20
```

### Queries

Define data queries for pages.

**Attributes:**
- `entity` (string, required): Entity to query
- `where` (object): Filter conditions
- `orderBy` (object): Sort order (field → "asc"/"desc")
- `limit` (number): Maximum results
- `offset` (number): Skip results
- `include` (string[]): Relations to include

### Forms

Define forms for creating, updating, or deleting entities.

**Syntax:**
```toml
[page."/posts/new".form]
entity = "Post"
method = "create"  # "create", "update", or "delete"

[[page."/posts/new".form.fields]]
name = "title"
type = "text"
required = true

[page."/posts/new".form.onSuccess]
redirect = "/posts/{id}"
message = "Post created successfully"
```

**Form Field Types:**
- `text`: Single-line text input
- `textarea`: Multi-line text input (supports `rows` attribute)
- `email`: Email input with validation
- `password`: Password input
- `number`: Numeric input (supports `min`, `max`, and `step` attributes)
- `select`: Dropdown select (requires `options` array)
- `checkbox`: Checkbox
- `radio`: Radio buttons (requires `options` array)
- `file`: File upload (supports `accept` array for MIME types, `max` for size limit in bytes)
- `date`: Date picker
- `datetime`: Date and time picker

**File Upload Field Example:**
```toml
[[page."/documents/upload".form.fields]]
name = "document"
type = "file"
label = "Upload Document"
required = true
accept = ["application/pdf", "image/jpeg", "image/png"]
max = 10485760  # 10MB in bytes
```

When a file is uploaded, the following fields are automatically stored in the database:
- `fieldname`: URL path to the uploaded file (e.g., `/uploads/01HQZT...abc.pdf`)
- `fieldname_id`: Unique file identifier
- `fieldname_filename`: Original filename
- `fieldname_size`: File size in bytes
- `fieldname_mimetype`: File MIME type

## Authentication

Configure authentication providers and session settings.

**Example:**
```toml
[auth]
providers = ["email", "github", "google"]
trustedOrigins = ["https://example.com"]

[auth.session]
duration = 2592000  # 30 days in seconds
idle_timeout = 1800  # 30 minutes
```

### Permissions (RBAC)

Define role-based access control rules.

```toml
[auth.permissions.admin]
allow = ["*"]  # All permissions

[auth.permissions.user]
allow = [
  { entity = "Post", actions = ["read", "create"] },
  { entity = "Comment", actions = ["read", "create", "update"], condition = { authorId = "$currentUser.id" } }
]
deny = ["User.delete"]
```

## Plugins

Configure plugins for extended functionality.

```toml
[[plugins]]
name = "stripe-payments"
version = "1.0.0"
enabled = true

[plugins.config]
api_key = "$env.STRIPE_API_KEY"
webhook_secret = "$env.STRIPE_WEBHOOK_SECRET"
```

## UI Configuration

Configure rendering mode, themes, and styling.

```toml
[ui]
render_mode = "hybrid"  # "server", "hybrid", or "spa"
progressive_enhancement = "htmx"  # "none", "alpine", or "htmx"
view_transitions = true

[ui.tailwind]
primary_color = "#3b82f6"
secondary_color = "#10b981"
font_family = "Inter"

[ui.css]
file = "./styles/custom.css"
```

## Workflows

Define automated workflows triggered by entity events.

```toml
[[workflows]]
name = "send-welcome-email"

[workflows.trigger]
entity = "User"
event = "create"

[[workflows.steps]]
type = "email"
to = "{{ user.email }}"
subject = "Welcome!"
template = "welcome-email"

[[workflows.steps]]
type = "webhook"
url = "https://api.example.com/user-created"
method = "POST"
body = { userId = "{{ user.id }}" }
```

## Access Control Summary

Zebric provides three layers of access control:

### 1. Entity-Level Access Control
Controls who can perform CRUD operations on entire records.

```toml
[entity.Post.access]
read = { or = [{ status = "published" }, { authorId = "$currentUser.id" }] }
update = { authorId = "$currentUser.id" }
delete = { "$currentUser.role" = "admin" }
```

### 2. Field-Level Access Control
Controls who can read or write specific fields.

```toml
fields = [
  {
    name = "salary",
    type = "Integer",
    access = {
      read = { "$currentUser.role" = "admin" },
      write = { "$currentUser.role" = "admin" }
    }
  }
]
```

### 3. Role-Based Permissions
Controls permissions based on user roles.

```toml
[auth.permissions.user]
allow = [
  { entity = "Post", actions = ["read", "create"] }
]
```

### Access Control Evaluation Order

1. **Authentication Check**: Is user authenticated (if required)?
2. **RBAC Check**: Does user's role allow this action?
3. **Entity-Level Check**: Does entity access rule allow this action?
4. **Field-Level Check**: Are individual fields accessible?

All checks must pass for access to be granted.

## Security Best Practices

1. **Principle of Least Privilege**: Start with restrictive defaults, grant access explicitly
2. **Defense in Depth**: Use multiple layers (RBAC + entity-level + field-level)
3. **Sensitive Fields**: Always use field-level access control for PII, financial data
4. **Audit Logging**: Enable audit logs for compliance and security monitoring
5. **Session Security**: Use appropriate session durations and idle timeouts
6. **Input Validation**: Define required fields and use appropriate types
7. **HTTPS Only**: Use `trustedOrigins` to enforce HTTPS in production

## Examples

See the `examples/` directory for complete Blueprint examples:
- `examples/blog/`: Blog with posts, comments, and authentication
- `examples/custom-theme/`: Custom theming and UI configuration

## Validation

Blueprints are validated at runtime using JSON Schema. Invalid Blueprints will produce detailed error messages.

Common validation errors:
- Missing required fields
- Invalid field types
- Malformed access conditions
- Invalid session variable references
- Circular entity references
