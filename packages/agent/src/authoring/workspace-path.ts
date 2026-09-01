import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

/** Resolve an existing path and reject lexical or symlink escapes from the workspace. */
export async function resolveExistingWorkspacePath(root: string, requestedPath: string): Promise<string> {
  const realRoot = await realpath(resolve(root))
  const realTarget = await realpath(resolve(realRoot, requestedPath))
  const pathFromRoot = relative(realRoot, realTarget)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromRoot)) {
    throw new Error('Blueprint path is outside the configured workspace')
  }
  return realTarget
}
