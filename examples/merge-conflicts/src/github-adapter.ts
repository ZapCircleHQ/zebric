import type { PullRequestMetadata } from './types.js'
import { LocalGitRepositoryAdapter, type LocalGitOptions } from './local-git-adapter.js'

export interface GitHubClient {
  getPullRequest(owner: string, repository: string, number: number): Promise<{
    title: string; body?: string; base: { ref: string }; head: { ref: string; sha: string }
  }>
  createResolutionPullRequest(input: { owner: string; repository: string; base: string; head: string; title: string }): Promise<{ url: string }>
}

export interface GitHubAdapterOptions extends LocalGitOptions {
  owner: string
  repository: string
  pullRequest: number
  client: GitHubClient
  push?: (worktree: string, branch: string) => Promise<void>
}

/**
 * GitHub is an integration edge: conflict inspection and validation still use
 * a real local clone. Callers prepare the merge in worktree before execution.
 */
export class GitHubRepositoryAdapter extends LocalGitRepositoryAdapter {
  private metadata?: PullRequestMetadata
  constructor(private readonly github: GitHubAdapterOptions) { super(github) }

  override async getMetadata(): Promise<PullRequestMetadata> {
    if (this.metadata) return this.metadata
    const pr = await this.github.client.getPullRequest(this.github.owner, this.github.repository, this.github.pullRequest)
    this.metadata = {
      repository: `${this.github.owner}/${this.github.repository}`,
      number: this.github.pullRequest,
      title: pr.title,
      body: pr.body,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
    }
    return this.metadata
  }

  override async publish(message: string): Promise<{ commit: string; url?: string }> {
    const result = await super.publish(message)
    const metadata = await this.getMetadata()
    const branch = `zebric/resolve-pr-${this.github.pullRequest}`
    if (!this.github.push) throw new Error('GitHub publishing requires an explicitly configured push function')
    await this.github.push(this.github.worktree, branch)
    const pr = await this.github.client.createResolutionPullRequest({
      owner: this.github.owner, repository: this.github.repository,
      base: metadata.headRef, head: branch, title: `Resolve conflicts for #${this.github.pullRequest}`,
    })
    return { ...result, url: pr.url }
  }
}
