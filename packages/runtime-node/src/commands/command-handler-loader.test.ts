import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Command } from '@zebric/runtime-core'
import { isFileHandlerReference, loadCommandHandler } from './command-handler-loader.js'

function command(handler: string): Command {
  return { name: 'ApproveRequest', entity: 'Request', handler }
}

describe('command handler loader', () => {
  it('loads default and named exports relative to the declaring TOML file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zebric-command-handler-'))
    const fragmentDir = join(root, 'commands')
    await mkdir(fragmentDir)
    const blueprintPath = join(root, 'blueprint.toml')
    const sourceFile = join(fragmentDir, 'requests.toml')
    const handlerFile = join(fragmentDir, 'approve.mjs')
    await writeFile(blueprintPath, 'version = "1"\n')
    await writeFile(sourceFile, '[command.ApproveRequest]\n')
    await writeFile(handlerFile, [
      'export default () => ({ status: "approved" })',
      'export const reject = () => ({ status: "rejected" })',
    ].join('\n'))

    const defaultHandler = await loadCommandHandler({
      command: command('./approve.mjs'), sourceFile, rootBlueprintPath: blueprintPath,
    })
    const namedHandler = await loadCommandHandler({
      command: command('./approve.mjs#reject'), sourceFile, rootBlueprintPath: blueprintPath,
    })

    expect(await defaultHandler({} as any)).toEqual({ status: 'approved' })
    expect(await namedHandler({} as any)).toEqual({ status: 'rejected' })
  })

  it('distinguishes file handlers from symbolic registrations', () => {
    expect(isFileHandlerReference('./approve.mjs')).toBe(true)
    expect(isFileHandlerReference('../approve.mjs#approve')).toBe(true)
    expect(isFileHandlerReference('commands.approve')).toBe(false)
  })

  it('rejects handlers outside the root Blueprint directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zebric-command-root-'))
    const sibling = await mkdtemp(join(tmpdir(), 'zebric-command-outside-'))
    const blueprintPath = join(root, 'blueprint.toml')
    const outsideHandler = join(sibling, 'handler.mjs')
    await writeFile(blueprintPath, 'version = "1"\n')
    await writeFile(outsideHandler, 'export default () => ({})\n')

    await expect(loadCommandHandler({
      command: command(relative(root, outsideHandler)),
      sourceFile: join(root, 'commands.toml'),
      rootBlueprintPath: blueprintPath,
    })).rejects.toThrow('must remain under the root Blueprint directory')
  })
})
