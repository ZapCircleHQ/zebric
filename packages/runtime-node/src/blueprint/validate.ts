/**
 * Blueprint Validation
 *
 * Wrapper around BlueprintParser from core for backwards compatibility.
 */

import { BlueprintParser } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'

/**
 * Validate a blueprint from string content
 */
export function validateBlueprint(content: string, format: 'toml' | 'json', source?: string): Blueprint {
  const parser = new BlueprintParser()
  return parser.parse(content, format, source)
}

/**
 * Validate a blueprint from a file path
 */
export async function validateBlueprintFile(path: string): Promise<Blueprint> {
  const { BlueprintLoader } = await import('./loader.js')
  return new BlueprintLoader().load(path)
}
