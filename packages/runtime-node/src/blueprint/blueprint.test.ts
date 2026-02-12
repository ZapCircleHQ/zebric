import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BlueprintLoader } from './loader.js'
import { validateBlueprint, validateBlueprintFile } from './validate.js'

function minimalBlueprintJson() {
  return JSON.stringify({
    version: '1.0',
    project: {
      name: 'test-app',
      version: '0.1.0',
      runtime: {
        min_version: '0.1.0',
      },
    },
    entities: [],
    pages: [],
  })
}

function minimalBlueprintToml() {
  return `
version = "1.0"

[project]
name = "test-app"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[[entities]]
name = "User"

[[entities.fields]]
name = "id"
type = "ULID"
primary_key = true

[[pages]]
path = "/"
title = "Home"
layout = "list"
`
}

describe('blueprint wrappers', () => {
  it('validates blueprint content from JSON string', () => {
    const parsed = validateBlueprint(minimalBlueprintJson(), 'json')
    expect(parsed.project.name).toBe('test-app')
    expect(parsed.hash.startsWith('sha256:')).toBe(true)
  })

  it('loads and validates blueprint files for JSON and TOML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zebric-blueprint-'))
    const jsonPath = join(dir, 'blueprint.json')
    const tomlPath = join(dir, 'blueprint.toml')

    await writeFile(jsonPath, minimalBlueprintJson(), 'utf-8')
    await writeFile(tomlPath, minimalBlueprintToml(), 'utf-8')

    const jsonBlueprint = await validateBlueprintFile(jsonPath)
    const tomlBlueprint = await validateBlueprintFile(tomlPath)

    expect(jsonBlueprint.project.name).toBe('test-app')
    expect(tomlBlueprint.entities[0]?.name).toBe('User')

    await rm(dir, { recursive: true, force: true })
  })

  it('loads with BlueprintLoader and validates runtime version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zebric-loader-'))
    const path = join(dir, 'blueprint.json')
    await writeFile(path, minimalBlueprintJson(), 'utf-8')

    const loader = new BlueprintLoader()
    const blueprint = await loader.load(path)

    expect(blueprint.project.runtime.min_version).toBe('0.1.0')
    expect(() => loader.validateVersion(blueprint, '0.1.0')).not.toThrow()
    expect(() => loader.validateVersion(blueprint, '0.0.1')).toThrow()

    await rm(dir, { recursive: true, force: true })
  })
})
