import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Choose a Blueprint without silently selecting between two application definitions. */
export function resolveBlueprintPath(path?: string, cwd = process.cwd()): string {
  if (path !== undefined) return resolve(cwd, path)
  const candidates = ['blueprint.toml', 'blueprint.json'].filter(name => existsSync(resolve(cwd, name)))
  if (candidates.length === 1) return resolve(cwd, candidates[0]!)
  if (candidates.length > 1) {
    throw new Error('Both blueprint.toml and blueprint.json exist. Use --blueprint <path> to choose which app to run or check.')
  }
  throw new Error('Blueprint file not found: expected blueprint.toml or blueprint.json in the current directory. Use --blueprint <path>, or run zebric init in an empty directory.')
}
