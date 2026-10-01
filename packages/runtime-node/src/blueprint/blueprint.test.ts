import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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

describe('modular TOML Blueprint composition', () => {
  async function fixture(): Promise<{ dir: string; root: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'zebric-modular-blueprint-'))
    await mkdir(join(dir, 'domain', 'requests'), { recursive: true })
    await mkdir(join(dir, 'foundation'), { recursive: true })
    const root = join(dir, 'blueprint.toml')
    await writeFile(root, `
imports = ["./domain/requests/module.toml", "./foundation/design-system.toml"]
version = "1.0"
[project]
name = "modular-app"
version = "0.6.0"
[project.runtime]
min_version = "0.6.0"
`, 'utf-8')
    await writeFile(join(dir, 'domain', 'requests', 'module.toml'), `
imports = ["./request-entity.toml", "./request-commands.toml"]
[workflow.ApprovePendingRequest]
trigger = { manual = true }
steps = [{ type = "command", command = "ApproveRequest", recordId = "{{ variables.requestId }}" }]
`, 'utf-8')
    await writeFile(join(dir, 'domain', 'requests', 'request-entity.toml'), `
[entity.Request]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "status", type = "Enum", values = ["pending", "approved"], write = "command-only", commands = ["ApproveRequest"] }
]
`, 'utf-8')
    await writeFile(join(dir, 'domain', 'requests', 'request-commands.toml'), `
[command.ApproveRequest]
entity = "Request"
mutations = { status = "approved" }
`, 'utf-8')
    await writeFile(join(dir, 'foundation', 'design-system.toml'), `
[design_system]
name = "modern"
[design_system.tokens]
brand = "#6d28d9"
`, 'utf-8')
    return { dir, root }
  }

  it('resolves recursive imports relative to each importing file and validates after composition', async () => {
    const { dir, root } = await fixture()
    try {
      const loader = new BlueprintLoader()
      const blueprint = await loader.load(root)

      expect(blueprint.entities.map(entity => entity.name)).toEqual(['Request'])
      expect(blueprint.commands?.map(command => command.name)).toEqual(['ApproveRequest'])
      expect(blueprint.workflows?.map(workflow => workflow.name)).toEqual(['ApprovePendingRequest'])
      expect(blueprint.design_system?.tokens?.brand).toBe('#6d28d9')
      expect(loader.getLoadedFiles()).toHaveLength(5)
      expect(loader.getSourceLocation('entity', 'Request')).toEqual({
        file: expect.stringMatching(/domain\/requests\/request-entity\.toml$/),
        line: 2,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('deduplicates the same canonical module imported through multiple branches', async () => {
    const { dir, root } = await fixture()
    try {
      await writeFile(join(dir, 'domain', 'requests', 'request-entity.toml'), `
imports = ["../../foundation/design-system.toml"]
[entity.Request]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "status", type = "Enum", values = ["pending", "approved"], write = "command-only", commands = ["ApproveRequest"] }
]
`, 'utf-8')
      const blueprint = await new BlueprintLoader().load(root)
      expect(blueprint.design_system?.name).toBe('modern')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports both source files and lines for duplicate flat definitions', async () => {
    const { dir, root } = await fixture()
    try {
      const duplicate = join(dir, 'domain', 'requests', 'duplicate.toml')
      await writeFile(duplicate, `
[entity.Request]
fields = [{ name = "id", type = "ULID", primary_key = true }]
`, 'utf-8')
      const modulePath = join(dir, 'domain', 'requests', 'module.toml')
      await writeFile(modulePath, `imports = ["./request-entity.toml", "./duplicate.toml"]\n`, 'utf-8')

      await expect(new BlueprintLoader().load(root)).rejects.toThrow(
        /Duplicate entity definition "Request".*request-entity\.toml:2.*duplicate\.toml:2/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects import cycles with the complete relative chain', async () => {
    const { dir, root } = await fixture()
    try {
      await writeFile(join(dir, 'domain', 'requests', 'request-entity.toml'), `
imports = ["./module.toml"]
[entity.Request]
fields = [{ name = "id", type = "ULID", primary_key = true }]
`, 'utf-8')
      await expect(new BlueprintLoader().load(root)).rejects.toThrow(
        /domain\/requests\/module\.toml -> domain\/requests\/request-entity\.toml -> domain\/requests\/module\.toml/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects imports outside the root directory and root metadata in fragments', async () => {
    const { dir, root } = await fixture()
    const outside = join(dirname(dir), `outside-${Date.now()}.toml`)
    try {
      await writeFile(outside, '[design_system]\nname = "modern"\n', 'utf-8')
      await writeFile(root, `imports = ["../${outside.split('/').pop()}"]\nversion = "1"\n[project]\nname = "x"\nversion = "1"\n[project.runtime]\nmin_version = "0.6.0"\n`, 'utf-8')
      await expect(new BlueprintLoader().load(root)).rejects.toThrow(/must remain under the root Blueprint directory/)

      await writeFile(root, `imports = ["./foundation/design-system.toml"]\nversion = "1"\n[project]\nname = "x"\nversion = "1"\n[project.runtime]\nmin_version = "0.6.0"\n`, 'utf-8')
      await writeFile(join(dir, 'foundation', 'design-system.toml'), `version = "1"\n[project]\nname = "nested"\nversion = "1"\n[project.runtime]\nmin_version = "0.6.0"\n`, 'utf-8')
      await expect(new BlueprintLoader().load(root)).rejects.toThrow(/must not define version or project/)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(outside, { force: true })
    }
  })

  it('changes the composed hash when an imported file changes', async () => {
    const { dir, root } = await fixture()
    try {
      const loader = new BlueprintLoader()
      const before = await loader.load(root)
      const design = join(dir, 'foundation', 'design-system.toml')
      await writeFile(design, '[design_system]\nname = "classic"\n', 'utf-8')
      const after = await loader.load(root)
      expect(after.hash).not.toBe(before.hash)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('allows array-style and named-table definitions in the same fragment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zebric-mixed-fragment-'))
    const root = join(dir, 'blueprint.toml')
    try {
      await writeFile(root, `
imports = ["./domain.toml"]
version = "1"
[project]
name = "mixed"
version = "0.6.0"
[project.runtime]
min_version = "0.6.0"
`, 'utf-8')
      await writeFile(join(dir, 'domain.toml'), `
[[entities]]
name = "Request"
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "status", type = "Text" }
]

[command.CloseRequest]
entity = "Request"
mutations = { status = "closed" }
`, 'utf-8')

      const blueprint = await new BlueprintLoader().load(root)
      expect(blueprint.entities[0]?.name).toBe('Request')
      expect(blueprint.commands?.[0]?.name).toBe('CloseRequest')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves declared depth-first definition order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zebric-import-order-'))
    const root = join(dir, 'blueprint.toml')
    try {
      await writeFile(root, `
imports = ["./first.toml", "./second.toml"]
version = "1"
[project]
name = "order"
version = "0.6.0"
[project.runtime]
min_version = "0.6.0"
[entity.Root]
fields = [{ name = "id", type = "ULID", primary_key = true }]
`, 'utf-8')
      await writeFile(join(dir, 'first.toml'), '[entity.First]\nfields = [{ name = "id", type = "ULID", primary_key = true }]\n', 'utf-8')
      await writeFile(join(dir, 'second.toml'), '[entity.Second]\nfields = [{ name = "id", type = "ULID", primary_key = true }]\n', 'utf-8')

      const blueprint = await new BlueprintLoader().load(root)
      expect(blueprint.entities.map(entity => entity.name)).toEqual(['First', 'Second', 'Root'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('attributes cross-module reference errors to the defining fragment', async () => {
    const { dir, root } = await fixture()
    try {
      const command = join(dir, 'domain', 'requests', 'request-commands.toml')
      await writeFile(command, `
[command.ApproveRequest]
entity = "Request"
mutations = { missingField = "approved" }
`, 'utf-8')
      await expect(new BlueprintLoader().load(root)).rejects.toThrow(
        /request-commands\.toml:2: Command "ApproveRequest" mutates unknown field/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects ambiguous singleton configuration instead of applying import precedence', async () => {
    const { dir, root } = await fixture()
    try {
      await writeFile(root, `
imports = ["./foundation/design-system.toml"]
version = "1"
[project]
name = "singletons"
version = "0.6.0"
[project.runtime]
min_version = "0.6.0"
[design_system]
name = "classic"
`, 'utf-8')
      await expect(new BlueprintLoader().load(root)).rejects.toThrow(
        /Singleton Blueprint section "design_system" is defined in both/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
