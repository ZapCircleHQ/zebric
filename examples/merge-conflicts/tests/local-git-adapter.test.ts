import { mkdtemp, readFile, rm, symlink, link, unlink, rename, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalGitRepositoryAdapter } from '../src/local-git-adapter.js'
import { createConflict, type GitFixture } from './git-fixture.js'

describe('LocalGitRepositoryAdapter', () => {
  let fixture: GitFixture | undefined
  afterEach(async () => fixture?.cleanup())

  it('inspects the three real Git index stages and publishes a validated resolution', async () => {
    fixture = await createConflict({ base: 'export const value = 1\n', ours: 'export const value = 2\n', theirs: 'export const value = 3\n' })
    const repository = new LocalGitRepositoryAdapter({ worktree: fixture.root })
    const [conflict] = await repository.getConflicts()
    expect(conflict).toMatchObject({ path: 'src/value.ts', base: 'export const value = 1\n', ours: 'export const value = 2\n', theirs: 'export const value = 3\n' })

    await repository.applyCandidate({ path: conflict!.path, content: 'export const value = 4\n', source: 'agent', resolver: 'test-agent', explanation: 'combined intent', assumptions: [], requiresHumanReview: false })
    expect((await repository.validate([])).passed).toBe(true)
    expect((await repository.publish('resolve conflict')).commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('rejects candidate paths outside the worktree', async () => {
    fixture = await createConflict({ base: 'a\n', ours: 'b\n', theirs: 'c\n' })
    const repository = new LocalGitRepositoryAdapter({ worktree: fixture.root })
    await expect(repository.applyCandidate({ path: '../escape', content: '', source: 'agent', resolver: 'bad', explanation: '', assumptions: [], requiresHumanReview: false })).rejects.toThrow('Unsafe repository path')
  })
  it('rejects unrelated files and Git metadata before writing', async () => {
    fixture = await createConflict({ base: 'a\n', ours: 'b\n', theirs: 'c\n' })
    const adapter = new LocalGitRepositoryAdapter({ worktree: fixture.root })
    await adapter.getConflicts()
    const candidate = { content: 'changed', source: 'agent' as const, resolver: 'test', explanation: '', assumptions: [], requiresHumanReview: false }
    await expect(adapter.applyCandidate({ ...candidate, path: 'README.md' })).rejects.toThrow('not an inspected conflict')
    await expect(adapter.applyCandidate({ ...candidate, path: '.git/config' })).rejects.toThrow('Unsafe repository path')
  })

  it.each(['file', 'directory', 'hardlink'] as const)('rejects a %s link swapped after inspection', async kind => {
    fixture = await createConflict({ base: 'a\n', ours: 'b\n', theirs: 'c\n' })
    const adapter = new LocalGitRepositoryAdapter({ worktree: fixture.root })
    await adapter.getConflicts()
    const outside = await mkdtemp('/private/tmp/merge-symlink-')
    try {
      await writeFile(`${outside}/value.ts`, 'outside sentinel')
      if (kind !== 'directory') {
        await unlink(`${fixture.root}/src/value.ts`)
        await (kind === 'hardlink' ? link : symlink)(`${outside}/value.ts`, `${fixture.root}/src/value.ts`)
      } else {
        await rename(`${fixture.root}/src`, `${fixture.root}/original-src`)
        await symlink(outside, `${fixture.root}/src`)
      }
      await expect(adapter.applyCandidate({ path: 'src/value.ts', content: 'escaped', source: 'agent', resolver: 'test', explanation: '', assumptions: [], requiresHumanReview: false })).rejects.toThrow('Unsafe repository path')
      expect(await readFile(`${outside}/value.ts`, 'utf8')).toBe('outside sentinel')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })

})
