import { execFile } from 'node:child_process'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { CandidateResolution, ConflictFile, PullRequestMetadata, RepositoryAdapter, ValidationCheck, ValidationResult } from './types.js'

const runFile = promisify(execFile)

export interface LocalGitOptions {
  worktree: string
  metadata?: Partial<PullRequestMetadata>
}

export class LocalGitRepositoryAdapter implements RepositoryAdapter {
  private readonly root: string
  constructor(private readonly options: LocalGitOptions) { this.root = resolve(options.worktree) }

  async getMetadata(): Promise<PullRequestMetadata> {
    const branch = (await this.git(['branch', '--show-current'])).trim() || 'detached'
    const top = (await realpath(this.root)).split(sep).at(-1) ?? 'local-repository'
    return {
      repository: this.options.metadata?.repository ?? top,
      title: this.options.metadata?.title ?? `Resolve conflicts on ${branch}`,
      baseRef: this.options.metadata?.baseRef ?? 'MERGE_HEAD',
      headRef: this.options.metadata?.headRef ?? branch,
      ...this.options.metadata,
    }
  }

  async getConflicts(): Promise<ConflictFile[]> {
    const names = (await this.git(['diff', '--name-only', '--diff-filter=U', '-z']))
      .split('\0').filter(Boolean)
    return Promise.all(names.map(async path => ({
      path,
      base: await this.stage(1, path),
      ours: await this.stage(2, path),
      theirs: await this.stage(3, path),
      conflicted: await readFile(this.safePath(path), 'utf8'),
    })))
  }

  async getRelevantHistory(path: string, limit = 8): Promise<string[]> {
    const output = await this.git(['log', `-${limit}`, '--format=%H%x09%s', '--', path])
    return output.trim() ? output.trim().split('\n') : []
  }

  async applyCandidate(candidate: CandidateResolution): Promise<void> {
    const path = this.safePath(candidate.path)
    await writeFile(path, candidate.content, 'utf8')
    await this.git(['add', '--', candidate.path])
  }

  async validate(commands: string[], paths?: string[]): Promise<ValidationResult> {
    const checks: ValidationCheck[] = []
    const pathArgs = paths?.length ? ['--', ...paths] : []
    const conflicts = await this.git(['diff', '--name-only', '--diff-filter=U', ...pathArgs])
    checks.push({ name: 'no-unmerged-paths', passed: conflicts.trim() === '', output: conflicts.trim() })
    const markerOutput = await this.git(['grep', '-n', '-E', '^(<<<<<<<|=======|>>>>>>>)', '--', ...(paths?.length ? paths : ['.'])], true)
    checks.push({ name: 'no-conflict-markers', passed: markerOutput.code === 1, output: markerOutput.stdout + markerOutput.stderr })
    const diffCheck = await this.git(['diff', '--check', '--cached', ...pathArgs], true)
    checks.push({ name: 'git-diff-check', passed: diffCheck.code === 0, output: diffCheck.stdout + diffCheck.stderr })

    for (const command of commands) {
      const result = await runShell(command, this.root)
      checks.push({ name: `command:${command}`, passed: result.code === 0, output: result.stdout + result.stderr })
    }
    return { passed: checks.every(check => check.passed), checks }
  }

  async publish(message: string): Promise<{ commit: string }> {
    const validation = await this.validate([])
    if (!validation.passed) {
      const failures = validation.checks.filter(check => !check.passed).map(check => check.name).join(', ')
      throw new Error(`Cannot publish an invalid resolution: ${failures}`)
    }
    await this.git(['commit', '-m', message])
    return { commit: (await this.git(['rev-parse', 'HEAD'])).trim() }
  }

  protected async git(args: string[]): Promise<string>
  protected async git(args: string[], tolerateFailure: true): Promise<{ code: number; stdout: string; stderr: string }>
  protected async git(args: string[], tolerateFailure = false): Promise<string | { code: number; stdout: string; stderr: string }> {
    try {
      const result = await runFile('git', ['-C', this.root, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      return tolerateFailure ? { code: 0, stdout: result.stdout, stderr: result.stderr } : result.stdout
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      if (tolerateFailure) return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
      throw new Error(`git ${args[0]} failed: ${(failure.stderr ?? String(error)).trim()}`)
    }
  }

  private async stage(stage: number, path: string): Promise<string> { return this.git(['show', `:${stage}:${path}`]) }

  private safePath(path: string): string {
    const target = resolve(this.root, path)
    const rel = relative(this.root, target)
    if (rel.startsWith('..' + sep) || rel === '..' || rel === '' || dirname(target) === target) throw new Error(`Unsafe repository path: ${path}`)
    return target
  }
}

async function runShell(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await runFile('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}
