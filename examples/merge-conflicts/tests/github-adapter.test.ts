import { describe, expect, it, vi } from 'vitest'
import { GitHubRepositoryAdapter } from '../src/github-adapter.js'

describe('GitHubRepositoryAdapter', () => {
  it('translates GitHub pull request metadata without leaking it into the workflow', async () => {
    const getPullRequest = vi.fn().mockResolvedValue({ title: 'Feature', body: 'Details', base: { ref: 'main' }, head: { ref: 'feature', sha: 'abc' } })
    const adapter = new GitHubRepositoryAdapter({ worktree: '/tmp/not-used', owner: 'zebric', repository: 'fixtures', pullRequest: 7, client: { getPullRequest, createResolutionPullRequest: vi.fn() } })
    await expect(adapter.getMetadata()).resolves.toEqual({ repository: 'zebric/fixtures', number: 7, title: 'Feature', body: 'Details', baseRef: 'main', headRef: 'feature', headSha: 'abc' })
  })
})
