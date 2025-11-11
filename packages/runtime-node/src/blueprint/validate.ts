/**
 * Blueprint Validation
 *
 * Wrapper around BlueprintParser from core for backwards compatibility.
 */

import { BlueprintParser, detectFormat } from '@zebric/runtime-core'
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
  const { readFile } = await import('node:fs/promises')
  const content = await readFile(path, 'utf-8')
  const format = detectFormat(path)
  return validateBlueprint(content, format, path)
}
