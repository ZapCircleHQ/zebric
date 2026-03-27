/**
 * BlueprintParser Benchmarks
 *
 * Measures parsing and validation cost — incurred at startup and on hot reload.
 */

import { bench, describe } from 'vitest'
import { BlueprintParser } from './loader.js'

const parser = new BlueprintParser()

const minimalToml = `
version = "0.3.0"

[project]
name = "bench-app"
version = "1.0.0"

[project.runtime]
min_version = "0.2.0"
`

const typicalToml = `
version = "0.3.0"

[project]
name = "bench-app"
version = "1.0.0"
description = "A typical benchmark application"

[project.runtime]
min_version = "0.2.0"

[[entities]]
name = "User"
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", required = true, unique = true },
  { name = "name", type = "Text", required = true },
  { name = "role", type = "Enum", values = ["user", "admin"], default = "user" },
  { name = "createdAt", type = "DateTime", default = "now()" }
]

[[entities]]
name = "Post"
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "body", type = "LongText" },
  { name = "status", type = "Enum", values = ["draft", "published"], default = "draft" },
  { name = "authorId", type = "Text" },
  { name = "createdAt", type = "DateTime", default = "now()" }
]

[[entities]]
name = "Comment"
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "body", type = "LongText", required = true },
  { name = "postId", type = "Text", required = true },
  { name = "authorId", type = "Text" },
  { name = "createdAt", type = "DateTime", default = "now()" }
]

[[pages]]
path = "/"
title = "Home"
layout = "list"

  [pages.queries.posts]
  entity = "Post"
  where = { status = "published" }
  limit = 10

[[pages]]
path = "/posts/:id"
title = "Post"
layout = "detail"

  [pages.queries.post]
  entity = "Post"

[[pages]]
path = "/posts/new"
title = "New Post"
layout = "form"

  [pages.form]
  entity = "Post"
  method = "create"
  fields = [
    { name = "title", type = "text", required = true, label = "Title" },
    { name = "body", type = "textarea", required = false, label = "Body" }
  ]
`

// Pre-parse once to get the JSON equivalent
const parsed = parser.parse(typicalToml, 'toml')
const typicalJson = JSON.stringify(parsed)
const minimalJson = JSON.stringify(parser.parse(minimalToml, 'toml'))

describe('BlueprintParser - TOML', () => {
  bench('parse minimal TOML', () => {
    parser.parse(minimalToml, 'toml')
  })

  bench('parse typical TOML (3 entities, 3 pages)', () => {
    parser.parse(typicalToml, 'toml')
  })
})

describe('BlueprintParser - JSON', () => {
  bench('parse minimal JSON', () => {
    parser.parse(minimalJson, 'json')
  })

  bench('parse typical JSON (3 entities, 3 pages)', () => {
    parser.parse(typicalJson, 'json')
  })
})

describe('BlueprintParser - TOML vs JSON', () => {
  bench('TOML round-trip', () => {
    parser.parse(typicalToml, 'toml')
  })

  bench('JSON round-trip (equivalent)', () => {
    parser.parse(typicalJson, 'json')
  })
})
