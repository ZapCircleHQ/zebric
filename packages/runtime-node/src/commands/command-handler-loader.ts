import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Command, CommandHandler } from '@zebric/runtime-core'

export function isFileHandlerReference(reference: string): boolean {
  const path = reference.split('#', 1)[0] ?? ''
  return path.startsWith('./') || path.startsWith('../') || isAbsolute(path)
}

export async function loadCommandHandler(options: {
  command: Command
  sourceFile: string
  rootBlueprintPath: string
}): Promise<CommandHandler> {
  const reference = options.command.handler
  if (!reference || !isFileHandlerReference(reference)) {
    throw new Error(`Command ${options.command.name} does not reference a handler file`)
  }

  const [fileReference, exportReference] = reference.split('#', 2)
  if (!fileReference || isAbsolute(fileReference)) {
    throw new Error(`Command handler ${reference} must use a relative file path`)
  }

  const rootDir = dirname(await realpath(options.rootBlueprintPath))
  const handlerPath = await realpath(resolve(dirname(options.sourceFile), fileReference))
  const pathFromRoot = relative(rootDir, handlerPath)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`Command handler ${reference} must remain under the root Blueprint directory`)
  }

  const url = pathToFileURL(handlerPath)
  url.searchParams.set('mtime', String((await stat(handlerPath)).mtimeMs))
  const module = await import(url.href) as Record<string, unknown>
  const exportName = exportReference || 'default'
  const handler = module[exportName]
  if (typeof handler !== 'function') {
    throw new Error(`Command handler ${reference} must export a ${exportName === 'default' ? 'default function' : `function named ${exportName}`}`)
  }
  return handler as CommandHandler
}
