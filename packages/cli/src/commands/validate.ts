/**
 * Validate Command
 *
 * Checks a Blueprint file against the runtime schema without starting the engine.
 */

import { resolve } from 'node:path'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import {
  BlueprintParser,
  detectFormat,
  BlueprintValidationError,
  type Blueprint,
} from '@zebric/runtime-node'
import { readFile } from 'node:fs/promises'

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

  const parser = new BlueprintParser()
  const startTime = Date.now()

  try {
    const content = await readFile(blueprintPath, 'utf-8')
    const format = detectFormat(blueprintPath)
    const blueprint = parser.parse(content, format, blueprintPath)
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
    console.error('')

    // Use the structured errors from the error object
    const structured = error.structured
    console.error(`${structured.type}: ${structured.message}`)
    console.error('')

    if (structured.errors.length > 0) {
      structured.errors.forEach((detail, index) => {
        const position = index + 1
        const locationPath = detail.location.path.length > 0
          ? detail.location.path.join('.')
          : 'root'

        console.error(`   ${position}. [${locationPath}] ${detail.message}`)

        if (detail.expected && detail.received) {
          console.error(`      Expected: ${detail.expected}`)
          console.error(`      Received: ${detail.received}`)
        }

        if (detail.suggestion) {
          console.error(`      💡 ${detail.suggestion}`)
        }

        console.error('')
      })
    }

    process.exit(1)
  }

  console.error(`❌ Failed to validate blueprint: ${path}`)
  console.error(
    error instanceof Error ? `   ${error.message}` : `   ${String(error)}`
  )
  process.exit(1)
}

