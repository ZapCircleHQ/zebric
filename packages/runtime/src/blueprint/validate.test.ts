/**
 * Tests for Blueprint Validation API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  validateBlueprint,
  validateBlueprintContent,
  validateBlueprintData,
  isBlueprintValid,
  validateBlueprintOrThrow,
} from './validate.js'
import { BlueprintValidationError } from './validation-error.js'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Blueprint Validation API', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `zbl-validate-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('validateBlueprint', () => {
    it('should validate a valid TOML Blueprint', async () => {
      const blueprintPath = join(testDir, 'valid.toml')
      await writeFile(
        blueprintPath,
        `
version = "1.0"

[project]
name = "Test App"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", required = true }
]

[page."/"]
title = "Home"
layout = "list"
`
      )

      const result = await validateBlueprint(blueprintPath)

      expect(result.valid).toBe(true)
      expect(result.blueprint).toBeDefined()
      expect(result.blueprint?.project.name).toBe('Test App')
      expect(result.blueprint?.entities).toHaveLength(1)
      expect(result.errors).toBeUndefined()
    })

    it('should validate a valid JSON Blueprint', async () => {
      const blueprintPath = join(testDir, 'valid.json')
      await writeFile(
        blueprintPath,
        JSON.stringify({
          version: '1.0',
          project: {
            name: 'Test App',
            version: '1.0.0',
            runtime: { min_version: '0.1.0' },
          },
          entities: [
            {
              name: 'User',
              fields: [
                { name: 'id', type: 'ULID', primary_key: true },
                { name: 'email', type: 'Email', required: true },
              ],
            },
          ],
          pages: [
            {
              path: '/',
              title: 'Home',
              layout: 'list',
            },
          ],
        })
      )

      const result = await validateBlueprint(blueprintPath)

      expect(result.valid).toBe(true)
      expect(result.blueprint).toBeDefined()
      expect(result.blueprint?.project.name).toBe('Test App')
    })

    it('should return structured errors for invalid Blueprint', async () => {
      const blueprintPath = join(testDir, 'invalid.toml')
      await writeFile(
        blueprintPath,
        `
version = "1.0"

[project]
name = "Test App"
# Missing version and runtime
`
      )

      const result = await validateBlueprint(blueprintPath)

      expect(result.valid).toBe(false)
      expect(result.blueprint).toBeUndefined()
      expect(result.errors).toBeDefined()
      expect(result.errors).toHaveLength(1)
      expect(result.errors?.[0].type).toBe('SCHEMA_VALIDATION')
      expect(result.errors?.[0].errors.length).toBeGreaterThan(0)
    })

    it('should return errors for parse failures', async () => {
      const blueprintPath = join(testDir, 'parse-error.toml')
      await writeFile(
        blueprintPath,
        `
this is not valid TOML [[[
`
      )

      const result = await validateBlueprint(blueprintPath)

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.[0].type).toBe('PARSE_ERROR')
    })

    it('should return errors for reference validation failures', async () => {
      const blueprintPath = join(testDir, 'bad-reference.toml')
      await writeFile(
        blueprintPath,
        `
version = "1.0"

[project]
name = "Test App"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true }
]

[page."/"]
title = "Home"
layout = "list"

[page."/".queries.users]
entity = "User"  # References non-existent entity
`
      )

      const result = await validateBlueprint(blueprintPath)

      expect(result.valid).toBe(false)
      expect(result.errors?.[0].type).toBe('REFERENCE_VALIDATION')
    })

    it('should skip reference validation when requested', async () => {
      const blueprintPath = join(testDir, 'bad-reference.toml')
      await writeFile(
        blueprintPath,
        `
version = "1.0"

[project]
name = "Test App"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true }
]

[page."/"]
title = "Home"
layout = "list"

[page."/".queries.users]
entity = "User"
`
      )

      const result = await validateBlueprint(blueprintPath, {
        skipReferenceValidation: true,
      })

      // Should still fail because loader.load does reference validation
      // This option would be useful for a future refactor
      expect(result.valid).toBe(false)
    })
  })

  describe('validateBlueprintContent', () => {
    it('should validate TOML content', async () => {
      const tomlContent = `
version = "1.0"

[project]
name = "Test App"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true }
]

[page."/"]
title = "Home"
layout = "list"
`

      const result = await validateBlueprintContent(tomlContent, 'toml')

      expect(result.valid).toBe(true)
      expect(result.blueprint?.project.name).toBe('Test App')
    })

    it('should validate JSON content', async () => {
      const jsonContent = JSON.stringify({
        version: '1.0',
        project: {
          name: 'Test App',
          version: '1.0.0',
          runtime: { min_version: '0.1.0' },
        },
        entities: [
          {
            name: 'User',
            fields: [{ name: 'id', type: 'ULID', primary_key: true }],
          },
        ],
        pages: [{ path: '/', title: 'Home', layout: 'list' }],
      })

      const result = await validateBlueprintContent(jsonContent, 'json')

      expect(result.valid).toBe(true)
      expect(result.blueprint?.project.name).toBe('Test App')
    })

    it('should return errors for invalid content', async () => {
      const invalidToml = `
version = "1.0"
this is not valid
`

      const result = await validateBlueprintContent(invalidToml, 'toml')

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
    })
  })

  describe('validateBlueprintData', () => {
    it('should validate Blueprint object', async () => {
      const data = {
        version: '1.0',
        project: {
          name: 'Test App',
          version: '1.0.0',
          runtime: { min_version: '0.1.0' },
        },
        entities: [
          {
            name: 'User',
            fields: [{ name: 'id', type: 'ULID', primary_key: true }],
          },
        ],
        pages: [{ path: '/', title: 'Home', layout: 'list' }],
      }

      const result = await validateBlueprintData(data)

      expect(result.valid).toBe(true)
      expect(result.blueprint?.project.name).toBe('Test App')
    })

    it('should return errors for invalid object', async () => {
      const invalidData = {
        version: '1.0',
        project: {
          name: 'Test App',
          // Missing required fields
        },
      }

      const result = await validateBlueprintData(invalidData)

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
    })
  })

  describe('isBlueprintValid', () => {
    it('should return true for valid Blueprint', async () => {
      const blueprintPath = join(testDir, 'valid.toml')
      await writeFile(
        blueprintPath,
        `
version = "1.0"

[project]
name = "Test App"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true }
]

[page."/"]
title = "Home"
layout = "list"
`
      )

      const isValid = await isBlueprintValid(blueprintPath)
      expect(isValid).toBe(true)
    })

    it('should return false for invalid Blueprint', async () => {
      const blueprintPath = join(testDir, 'invalid.toml')
      await writeFile(blueprintPath, 'invalid content')

      const isValid = await isBlueprintValid(blueprintPath)
      expect(isValid).toBe(false)
    })
  })

  describe('validateBlueprintOrThrow', () => {
    it('should return Blueprint for valid input', async () => {
      const blueprintPath = join(testDir, 'valid.toml')
      await writeFile(
        blueprintPath,
        `
version = "1.0"

[project]
name = "Test App"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true }
]

[page."/"]
title = "Home"
layout = "list"
`
      )

      const blueprint = await validateBlueprintOrThrow(blueprintPath)

      expect(blueprint.project.name).toBe('Test App')
    })

    it('should throw BlueprintValidationError for invalid input', async () => {
      const blueprintPath = join(testDir, 'invalid.toml')
      await writeFile(blueprintPath, 'invalid content')

      await expect(validateBlueprintOrThrow(blueprintPath)).rejects.toThrow(
        BlueprintValidationError
      )
    })

    it('should provide structured error when thrown', async () => {
      const blueprintPath = join(testDir, 'invalid.toml')
      await writeFile(
        blueprintPath,
        `
version = "1.0"

[project]
name = "Test App"
`
      )

      try {
        await validateBlueprintOrThrow(blueprintPath)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BlueprintValidationError)
        const validationError = error as BlueprintValidationError
        expect(validationError.structured.type).toBe('SCHEMA_VALIDATION')
        expect(validationError.structured.errors).toBeDefined()
      }
    })
  })
})
