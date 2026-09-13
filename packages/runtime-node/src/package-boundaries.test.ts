import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
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
