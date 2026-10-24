import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { auditBlueprint, BlueprintValidationError, type AuditSeverity } from '@zebric/runtime-core'
import { BlueprintLoader } from '@zebric/runtime-node'

export interface AuditOptions {
  blueprint?: string
  format?: 'text' | 'json'
  output?: string
  check?: string
  failOn?: AuditSeverity | 'none'
}

export async function auditCommand(options: AuditOptions = {}): Promise<void> {
  try {
    if (options.output && options.check) throw new Error('--output and --check cannot be combined')
    const blueprint = await new BlueprintLoader().load(resolve(options.blueprint ?? 'blueprint.toml'))
    const report = auditBlueprint(blueprint)
    const json = `${JSON.stringify(report, null, 2)}\n`
    if (options.output) await writeFile(resolve(options.output), json, 'utf8')
    if (options.check) {
      const expected: unknown = JSON.parse(await readFile(resolve(options.check), 'utf8'))
      if (!isDeepStrictEqual(expected, report)) {
        throw new Error(`Audit snapshot differs: ${options.check}. Review the findings and regenerate with --output ${options.check}.`)
      }
    }
    if (options.format === 'json') {
      console.log(json.trimEnd())
    } else {
      for (const finding of report.findings) {
        console.log(`${finding.severity.toUpperCase()} ${finding.ruleId} ${JSON.stringify(finding.path)}: ${finding.message}\n  ${finding.suggestion}`)
      }
      console.log(`Audit: ${report.summary.error} errors, ${report.summary.warning} warnings, ${report.summary.info} informational findings${options.check ? ' (snapshot matches)' : ''}`)
    }
    const levels: AuditSeverity[] = ['error', 'warning', 'info']
    const threshold = options.failOn ?? 'error'
    if (threshold !== 'none' && levels.slice(0, levels.indexOf(threshold) + 1).some(level => report.summary[level] > 0)) {
      process.exitCode = 1
    }
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      console.error(`Blueprint validation failed: ${JSON.stringify(error.structured, null, 2)}`)
    } else {
      console.error(`Failed to audit blueprint: ${error instanceof Error ? error.message : String(error)}`)
    }
    process.exitCode = 1
  }
}
