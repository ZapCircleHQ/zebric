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
})
