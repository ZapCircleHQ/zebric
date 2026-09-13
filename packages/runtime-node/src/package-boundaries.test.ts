import { builtinModules, createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const manifest = require('../package.json') as {
  dependencies?: Record<string, string>
}
const workspaceConfig = readFileSync(
  resolve(import.meta.dirname, '../../../pnpm-workspace.yaml'),
  'utf8',
)
const lockfile = readFileSync(
  resolve(import.meta.dirname, '../../../pnpm-lock.yaml'),
  'utf8',
)
const repositoryRoot = resolve(import.meta.dirname, '../../..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.ts') || /\.(?:test|spec|bench)\.ts$/.test(entry.name)) return []
    return [path]
  })
}

function moduleSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return Array.from(
    source.matchAll(/(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"]([^'"]+)['"]/g),
    match => match[1]!,
  )
}

const nodeBuiltins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))

function boundaryViolations(
  packageName: string,
  forbiddenPackages: string[],
  forbidNodeBuiltins: boolean,
): string[] {
  const sourceDirectory = resolve(repositoryRoot, 'packages', packageName, 'src')
  return sourceFiles(sourceDirectory).flatMap(file =>
    moduleSpecifiers(file)
      .filter(specifier =>
        forbiddenPackages.some(name => specifier === name || specifier.startsWith(`${name}/`))
        || (forbidNodeBuiltins && nodeBuiltins.has(specifier))
      )
      .map(specifier => `${file.slice(repositoryRoot.length + 1)} -> ${specifier}`)
  )
}

describe('published package boundaries', () => {
  it('does not ship build-time database tooling as a runtime dependency', () => {
    expect(manifest.dependencies).not.toHaveProperty('drizzle-kit')
  })

  it('requires workspace peer dependencies to be declared explicitly', () => {
    expect(workspaceConfig).toMatch(/^autoInstallPeers: false$/m)
  })

  it('does not resolve the optional drizzle-kit peer into the install graph', () => {
    expect(lockfile).not.toMatch(/^ {2}drizzle-kit@/m)
  })
})

describe('runtime dependency direction', () => {
  it('keeps runtime-core platform independent', () => {
    expect(boundaryViolations(
      'runtime-core',
      ['@zebric/runtime-hono', '@zebric/runtime-node', '@zebric/runtime-worker'],
      true,
    )).toEqual([])
  })

  it('keeps runtime-hono dependent only on runtime-core', () => {
    expect(boundaryViolations(
      'runtime-hono',
      ['@zebric/runtime-node', '@zebric/runtime-worker'],
      true,
    )).toEqual([])
  })

  it('prevents platform adapters from depending on each other', () => {
    expect([
      ...boundaryViolations('runtime-node', ['@zebric/runtime-worker'], false),
      ...boundaryViolations('runtime-worker', ['@zebric/runtime-node'], true),
    ]).toEqual([])
  })

  it('keeps platform entry points from re-exporting core or Hono APIs', () => {
    const publicBarrels = [
      'packages/runtime-node/src/index.ts',
      'packages/runtime-node/src/renderer/index.ts',
      'packages/runtime-node/src/server/index.ts',
      'packages/runtime-worker/src/index.ts',
    ]

    for (const relativePath of publicBarrels) {
      const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
      expect(source, relativePath).not.toMatch(
        /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]@zebric\/runtime-(?:core|hono)['"]/s,
      )
    }
  })
})
