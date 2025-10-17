/**
 * Validate Command
 *
 * Checks a Blueprint file against the runtime schema without starting the engine.
 */

import { resolve } from 'node:path'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import {
  BlueprintLoader,
  BlueprintValidationError,
  type Blueprint,
} from '@zebric/runtime'

export interface ValidateOptions {
  blueprint?: string
}

export async function validateCommand(options: ValidateOptions = {}): Promise<void> {
  const blueprintPath = resolve(
    process.cwd(),
    options.blueprint ?? 'blueprint.toml'
  )

  try {
    await access(blueprintPath, fsConstants.F_OK)
  } catch {
    console.error(`❌ Blueprint file not found at ${blueprintPath}`)
    console.error('   Use --blueprint to point to an existing TOML or JSON file.')
    process.exit(1)
  }

  const loader = new BlueprintLoader()
  const startTime = Date.now()

  try {
    const blueprint = await loader.load(blueprintPath)
    const elapsed = Date.now() - startTime

    reportSuccess(blueprintPath, blueprint, elapsed)
  } catch (error) {
    handleValidationError(error, blueprintPath)
  }
}

function reportSuccess(path: string, blueprint: Blueprint, elapsedMs: number): void {
  console.log(`✅ Blueprint valid: ${path}`)
  console.log(`   Version: ${blueprint.version}`)
  console.log(
    `   Project: ${blueprint.project.name} (${blueprint.entities.length} entities, ${blueprint.pages.length} pages${
      blueprint.workflows ? `, ${blueprint.workflows.length} workflows` : ''
    })`
  )
  console.log(`   Checked in ${elapsedMs}ms`)
}

function handleValidationError(error: unknown, path: string): never {
  if (error instanceof BlueprintValidationError) {
    console.error(`❌ Blueprint validation failed: ${path}`)

    if (Array.isArray(error.errors) && error.errors.length > 0) {
      error.errors.forEach((detail, index) => {
        const position = index + 1

        if (typeof detail === 'string') {
          console.error(`   ${position}. ${detail}`)
          return
        }

        const message = (detail as any).message ?? 'Unknown validation error'
        const zodPath = Array.isArray((detail as any).path)
          ? (detail as any).path.filter(Boolean).join('.')
          : undefined

        if (zodPath) {
          console.error(`   ${position}. [${zodPath}] ${message}`)
        } else {
          console.error(`   ${position}. ${message}`)
        }
      })
    } else {
      console.error(`   ${error.message}`)
    }

    process.exit(1)
  }

  console.error(`❌ Failed to validate blueprint: ${path}`)
  console.error(
    error instanceof Error ? `   ${error.message}` : `   ${String(error)}`
  )
  process.exit(1)
}

