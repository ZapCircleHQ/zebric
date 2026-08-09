import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveExistingWorkspacePath } from './workspace-path.js'

describe('resolveExistingWorkspacePath', () => {
  let root = ''
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })

  it('accepts an existing file inside the workspace', async () => {
    root = await mkdtemp(join(tmpdir(), 'zebric-workspace-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'blueprint.toml'), 'version = "1.0"')
    expect(await resolveExistingWorkspacePath(workspace, 'blueprint.toml'))
      .toBe(await realpath(join(workspace, 'blueprint.toml')))
  })

  it('rejects a symlink that resolves outside the workspace', async () => {
    root = await mkdtemp(join(tmpdir(), 'zebric-workspace-'))
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside.toml')
    await mkdir(workspace)
    await writeFile(outside, 'version = "1.0"')
    await symlink(outside, join(workspace, 'linked.toml'))
    await expect(resolveExistingWorkspacePath(workspace, 'linked.toml'))
      .rejects.toThrow('outside the configured workspace')
  })

  it('rejects a lexical traversal to an existing external file', async () => {
    root = await mkdtemp(join(tmpdir(), 'zebric-workspace-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(root, 'outside.toml'), 'version = "1.0"')
    await expect(resolveExistingWorkspacePath(workspace, '../outside.toml'))
      .rejects.toThrow('outside the configured workspace')
  })
})
