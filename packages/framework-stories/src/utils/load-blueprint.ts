import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { BlueprintParser } from '@zebric/runtime-core'

const parser = new BlueprintParser()
// Walk up from this file to find the workspace root (directory containing pnpm-workspace.yaml)
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function findWorkspaceRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  // Fallback to cwd if not found
  return process.cwd()
}

const workspaceRoot = findWorkspaceRoot()

export async function loadBlueprint(blueprintPath: string) {
  const absolutePath = path.join(workspaceRoot, blueprintPath)
  const contents = await readFile(absolutePath, 'utf8')
  return parser.parse(contents, 'toml', absolutePath)
}
