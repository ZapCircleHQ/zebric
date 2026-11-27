import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BlueprintLoader } from '@zebric/runtime-node'
import { createProject } from './init.js'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zebric-init-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('project creation', () => {
  it('creates the canonical app in a path with spaces, with runnable scripts and a pinned CLI', async () => {
    const target = await createProject(join(directory, 'My App'))
    const packageJson = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
    const cliPackage = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(packageJson.name).toBe('my-app')
    expect(packageJson.dependencies['@zebric/cli']).toBe(cliPackage.version)
    expect(packageJson.scripts).toEqual({ dev: 'zebric dev --seed', validate: 'zebric validate', audit: 'zebric audit' })
    expect(await readFile(join(target, '.gitignore'), 'utf8')).toContain('data/')
    const blueprint = await new BlueprintLoader().load(join(target, 'blueprint.toml'))
    expect(blueprint.entities[0]?.seed).toHaveLength(3)
    expect(blueprint.pages.find(page => page.path === '/posts/new')?.auth).toBe('required')
  })
  it('accepts an existing empty directory', async () => {
    await createProject(directory)
    expect(await readdir(directory)).toEqual(expect.arrayContaining(['blueprint.toml', 'package.json', '.gitignore', 'README.md']))
  })
  it('preserves existing files and refuses to add files to nonempty directories', async () => {
    await writeFile(join(directory, 'notes.txt'), 'keep this')
    await expect(createProject(directory)).rejects.toThrow('Refusing to overwrite')
    expect(await readdir(directory)).toEqual(['notes.txt'])
    expect(await readFile(join(directory, 'notes.txt'), 'utf8')).toBe('keep this')
  })
  it('refuses file and symlink destinations without changing them', async () => {
    const file = join(directory, 'file')
    await writeFile(file, 'keep this')
    await expect(createProject(file)).rejects.toThrow('Refusing to overwrite')
    const link = join(directory, 'link')
    await symlink(directory, link)
    await expect(createProject(link)).rejects.toThrow('Refusing to overwrite')
    expect(await readFile(file, 'utf8')).toBe('keep this')
  })
})
