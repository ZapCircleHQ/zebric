/**
 * CloudFlare Workers Blog Example
 *
 * This example demonstrates how to run Zebric on CloudFlare Workers
 * using D1 for the database, KV for caching, and R2 for file storage.
 */

import { createWorkerHandler } from '@zebric/runtime-worker'

// Blueprint content (inline for simplicity, could also be loaded from R2)
const blueprintContent = `
version = "0.3.0"

[project]
name = "workers-blog"
description = "A simple blog running on CloudFlare Workers"

[project.runtime]
min_version = "0.2.0"

# Post entity
[[entities]]
name = "post"

[[entities.fields]]
name = "title"
type = "String"
required = true

[[entities.fields]]
name = "slug"
type = "String"
required = true
unique = true

[[entities.fields]]
name = "content"
type = "Text"
required = true

[[entities.fields]]
name = "published"
type = "Boolean"
default = false

[[entities.fields]]
name = "publishedAt"
type = "DateTime"

# Comment entity
[[entities]]
name = "comment"

[[entities.fields]]
name = "postId"
type = "Ref"
ref = "post.id"
required = true

[[entities.fields]]
name = "author"
type = "String"
required = true

[[entities.fields]]
name = "content"
type = "Text"
required = true

[[entities.fields]]
name = "approved"
type = "Boolean"
default = false

# Pages
[[pages]]
path = "/"
title = "Blog Home"
template = "home"

[pages.queries.posts]
entity = "post"
filter = { published = true }
sort = "publishedAt desc"
limit = 10

[[pages]]
path = "/posts/:slug"
title = "{{ post.title }}"
template = "post"

[pages.queries.post]
entity = "post"
filter = { slug = "{{ params.slug }}" }

[pages.queries.comments]
entity = "comment"
filter = { postId = "{{ post.id }}", approved = true }
`

export default createWorkerHandler({
  blueprintContent,
  blueprintFormat: 'toml'
})
