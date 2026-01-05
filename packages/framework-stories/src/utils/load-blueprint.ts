import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { BlueprintParser } from '../../../runtime-core/src/blueprint/loader.js'

const parser = new BlueprintParser()
const workspaceRoot = path.resolve(process.cwd(), '..', '..')

export async function loadBlueprint(blueprintPath: string) {
  const absolutePath = path.join(workspaceRoot, blueprintPath)
  const contents = await readFile(absolutePath, 'utf8')
  return parser.parse(contents, 'toml', absolutePath)
}
