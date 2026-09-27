import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const runFile = promisify(execFile)

export interface GitFixture {
  root: string
  cleanup(): Promise<void>
}

export async function createConflict(input: { path?: string; base: string; ours: string; theirs: string }): Promise<GitFixture> {
  return createConflicts([{ ...input, path: input.path ?? 'src/value.ts' }])
}

export async function createConflicts(inputs: Array<{ path: string; base: string; ours: string; theirs: string }>): Promise<GitFixture> {
  const root = await mkdtemp(join(tmpdir(), 'zebric-merge-conflict-'))
  await run('git', ['init', '-b', 'main'], root)
  await run('git', ['config', 'user.email', 'fixture@zebric.local'], root)
  await run('git', ['config', 'user.name', 'Zebric Fixture'], root)
  for (const input of inputs) {
    await mkdir(join(root, input.path.split('/').slice(0, -1).join('/')), { recursive: true })
    await writeFile(join(root, input.path), input.base)
  }
  await run('git', ['add', '.'], root); await run('git', ['commit', '-m', 'base'], root)
  await run('git', ['checkout', '-b', 'feature'], root)
  for (const input of inputs) await writeFile(join(root, input.path), input.theirs)
  await run('git', ['commit', '-am', 'feature change'], root)
  await run('git', ['checkout', 'main'], root)
  for (const input of inputs) await writeFile(join(root, input.path), input.ours)
  await run('git', ['commit', '-am', 'main change'], root)
  try { await run('git', ['merge', 'feature'], root) } catch { /* expected conflict */ }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await runFile(command, args, { cwd })
}
