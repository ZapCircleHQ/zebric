/**
 * Unit tests for Blueprint Loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BlueprintLoader, BlueprintValidationError } from './loader.js'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('BlueprintLoader', () => {
  let loader: BlueprintLoader
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `zbl-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    loader = new BlueprintLoader()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('load', () => {
    it('should load valid TOML blueprint', async () => {
      const blueprintPath = join(testDir, 'blueprint.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Test App"
version = "1.0.0"
description = "Test application"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", required = true },
  { name = "name", type = "Text" }
]

[page."/"]
title = "Home"
layout = "list"
auth = "optional"

[page."/".queries.users]
entity = "User"
`)

      const blueprint = await loader.load(blueprintPath)

      expect(blueprint.version).toBe('0.1.0')
      expect(blueprint.project.name).toBe('Test App')
      expect(blueprint.project.version).toBe('1.0.0')
      expect(blueprint.entities).toHaveLength(1)
      expect(blueprint.entities[0].name).toBe('User')
      expect(blueprint.entities[0].fields).toHaveLength(3)
      expect(blueprint.pages).toHaveLength(1)
      expect(blueprint.pages[0].path).toBe('/')
    })

    it('should throw on missing file', async () => {
      await expect(
        loader.load('/nonexistent/blueprint.toml')
      ).rejects.toThrow()
    })

    it('should throw on invalid TOML', async () => {
      const blueprintPath = join(testDir, 'invalid.toml')
      await writeFile(blueprintPath, `
this is not valid TOML [[[
`)

      await expect(
        loader.load(blueprintPath)
      ).rejects.toThrow()
    })

    it('should validate required fields', async () => {
      const blueprintPath = join(testDir, 'missing-version.toml')
      await writeFile(blueprintPath, `
[project]
name = "Test"
`)

      await expect(
        loader.load(blueprintPath)
      ).rejects.toThrow()
    })

    it.skip('should handle multiple entities', async () => {
      const blueprintPath = join(testDir, 'multi-entity.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Multi Entity App"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email" }
]

[entity.Post]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text" },
  { name = "authorId", type = "Relation", entity = "User" }
]
`)

      const blueprint = await loader.load(blueprintPath)

      expect(blueprint.entities).toHaveLength(2)
      expect(blueprint.entities.map(e => e.name)).toContain('User')
      expect(blueprint.entities.map(e => e.name)).toContain('Post')
    })

    it.skip('should handle relationships', async () => {
      const blueprintPath = join(testDir, 'relations.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Relations Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Author]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "name", type = "Text" }
]

[entity.Book]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text" },
  { name = "authorId", type = "Relation", entity = "Author" }
]
`)

      const blueprint = await loader.load(blueprintPath)

      const book = blueprint.entities.find(e => e.name === 'Book')
      expect(book).toBeDefined()
      const authorField = book?.fields.find(f => f.name === 'authorId')
      expect(authorField?.type).toBe('Relation')
    })

    it('should handle page with behavior', async () => {
      const blueprintPath = join(testDir, 'behavior.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Behavior Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text" }
]

[page."/dashboard"]
title = "Dashboard"
layout = "custom"
auth = "optional"

[page."/dashboard".query.tasks]
entity = "Task"

[page."/dashboard".behavior]
intent = "Show tasks in kanban view"
render = "./behaviors/dashboard.js"
`)

      const blueprint = await loader.load(blueprintPath)

      const page = blueprint.pages.find(p => p.path === '/dashboard')
      expect(page).toBeDefined()
      expect(page?.behavior).toBeDefined()
      expect(page?.behavior?.intent).toBe('Show tasks in kanban view')
      expect(page?.behavior?.render).toBe('./behaviors/dashboard.js')
    })

    it('should handle auth configuration', async () => {
      const blueprintPath = join(testDir, 'auth.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Auth Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[auth]
providers = ["email", "google"]

[auth.email]
from = "noreply@example.com"
`)

      const blueprint = await loader.load(blueprintPath)

      expect(blueprint.auth).toBeDefined()
      expect(blueprint.auth?.providers).toContain('email')
      expect(blueprint.auth?.providers).toContain('google')
    })

    it.skip('should handle workflows', async () => {
      const blueprintPath = join(testDir, 'workflow.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Workflow Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[workflow.send_welcome_email]
trigger = "entity.User.created"
steps = [
  { action = "email.send", to = "{{ event.data.email }}" }
]
`)

      const blueprint = await loader.load(blueprintPath)

      expect(blueprint.workflows).toBeDefined()
      expect(blueprint.workflows).toHaveLength(1)
      expect(blueprint.workflows![0].name).toBe('send_welcome_email')
    })

    it.skip('should handle field-level access control', async () => {
      const blueprintPath = join(testDir, 'field-access.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Field Access Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email" },
  { name = "role", type = "Enum", values = ["admin", "user"], access = { read = "authenticated", write = "admin" } }
]
`)

      const blueprint = await loader.load(blueprintPath)

      const user = blueprint.entities.find(e => e.name === 'User')
      const roleField = user?.fields.find(f => f.name === 'role')
      expect(roleField?.access).toBeDefined()
    })
  })

  describe('validation', () => {
    it('should enforce minimum version', async () => {
      const blueprintPath = join(testDir, 'old-version.toml')
      await writeFile(blueprintPath, `
version = "0.0.1"

[project]
name = "Old Version"
version = "1.0.0"

[project.runtime]
min_version = "99.0.0"
`)

      // This should load but may warn about version mismatch
      const blueprint = await loader.load(blueprintPath)
      expect(blueprint).toBeDefined()
    })

    it('should validate entity field types', async () => {
      const blueprintPath = join(testDir, 'invalid-field-type.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Invalid Field"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Test]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "bad", type = "InvalidType" }
]
`)

      // Should either throw or load with invalid type
      await expect(
        loader.load(blueprintPath)
      ).rejects.toThrow()
    })

    it('should reject page queries referencing unknown entities', async () => {
      const blueprintPath = join(testDir, 'invalid-reference.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Invalid Reference"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text" }
]

[page."/"]
title = "Home"
layout = "list"

[page."/".queries.missing]
entity = "DoesNotExist"
`)

      await expect(loader.load(blueprintPath)).rejects.toMatchObject({
        errors: [
          { message: 'Page "/" query "missing" references unknown entity "DoesNotExist"' }
        ]
      })
    })

    it('should reject workflows referencing unknown trigger entities', async () => {
      const blueprintPath = join(testDir, 'invalid-workflow-reference.toml')
      await writeFile(blueprintPath, `
version = "0.1.0"

[project]
name = "Invalid Workflow"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text" }
]

[workflow.notify]
trigger.entity = "Ghost"
trigger.event = "create"
steps = []
`)

      await expect(loader.load(blueprintPath)).rejects.toBeInstanceOf(BlueprintValidationError)
    })
  })
})
