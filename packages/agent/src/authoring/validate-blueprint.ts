import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  BlueprintParser,
  BlueprintValidationError,
  type Blueprint,
  type ValidationErrorDetail,
} from '@zebric/runtime-core'

export interface ValidateBlueprintInput {
  path: string
  cwd?: string
}

export type BlueprintValidationResult =
  | { valid: true; path: string; blueprint: Blueprint }
  | { valid: false; path: string; errors: ValidationErrorDetail[] }

export async function validateBlueprint(
  input: ValidateBlueprintInput
): Promise<BlueprintValidationResult> {
  const path = resolve(input.cwd ?? process.cwd(), input.path)
  const source = await readFile(path, 'utf8')
  const format = path.endsWith('.json') ? 'json' : 'toml'

  try {
    const blueprint = new BlueprintParser().parse(source, format, path)
    return { valid: true, path, blueprint }
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      return { valid: false, path, errors: error.structured.errors }
    }
    throw error
  }
}
