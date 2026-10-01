import { resolve } from 'node:path'
import {
  BlueprintValidationError,
  type Blueprint,
  type ValidationErrorDetail,
} from '@zebric/runtime-core'
import { BlueprintLoader } from '@zebric/runtime-node'

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
  try {
    const blueprint = await new BlueprintLoader().load(path)
    return { valid: true, path, blueprint }
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      return { valid: false, path, errors: error.structured.errors }
    }
    throw error
  }
}
