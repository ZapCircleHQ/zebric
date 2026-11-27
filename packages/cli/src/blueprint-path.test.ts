import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBlueprintPath } from './blueprint-path.js'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zebric-path-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('Blueprint discovery', () => {
  it.each(['blueprint.toml', 'blueprint.json'])('selects the only default file: %s', async name => {
    await writeFile(join(directory, name), '')
    expect(resolveBlueprintPath(undefined, directory)).toBe(join(directory, name))
  })
  it('requires an explicit choice when both files exist, and honors that choice', async () => {
    await writeFile(join(directory, 'blueprint.toml'), '')
    await writeFile(join(directory, 'blueprint.json'), '')
    expect(() => resolveBlueprintPath(undefined, directory)).toThrow('Both blueprint.toml and blueprint.json')
    expect(resolveBlueprintPath('blueprint.json', directory)).toBe(join(directory, 'blueprint.json'))
    expect(resolveBlueprintPath('elsewhere.toml', directory)).toBe(join(directory, 'elsewhere.toml'))
  })
  it('explains how to recover when neither file exists', () => {
    expect(() => resolveBlueprintPath(undefined, directory)).toThrow('zebric init')
  })
})
