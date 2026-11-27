#!/usr/bin/env node

/**
 * Zebric CLI
 *
 * Command-line interface for Zebric Engine (ZBL Runtime).
 */

import { readFileSync } from 'node:fs'
import { parsePort } from './dev-preflight.js'
import { Command, Option } from 'commander'
import { auditCommand, benchmarkCommand, devCommand, initCommand, validateCommand } from './commands/index.js'

function getCliVersion(): string {
  const packageJsonUrl = new URL('../package.json', import.meta.url)
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as { version?: string }
  return packageJson.version ?? '0.0.0'
}

const program = new Command()

program
  .name('zebric')
  .description('Zebric - Run applications from TOML or JSON Blueprints')
  .version(getCliVersion())

program
  .command('init')
  .description('Create the first-app starter in a new or empty directory (no install)')
  .argument('[directory]', 'Project directory', '.')
  .action(initCommand)

// Dev command
program
  .command('dev')
  .description('Start development server with hot reload')
  .option('-b, --blueprint <path>', 'Blueprint path (auto-detect TOML or JSON)')
  .option('-p, --port <number>', 'App port (0 selects a free port)', parsePort, 3000)
  .option('--admin-port <number>', 'Admin port (default: app port + 30; 0 selects a free port)', parsePort)
  .option('-h, --host <host>', 'Host to bind to', 'localhost')
  .option('--seed', 'Seed database with sample data')
  .action(async (options) => {
    await devCommand({
      blueprint: options.blueprint,
      port: options.port,
      adminPort: options.adminPort,
      host: options.host,
      seed: options.seed,
    })
  })

// Validate command
program
  .command('validate')
  .description('Validate a blueprint file without starting the engine')
  .option('-b, --blueprint <path>', 'Blueprint path (auto-detect TOML or JSON)')
  .action(async (options) => {
    await validateCommand({
      blueprint: options.blueprint,
    })
  })

program
  .command('audit')
  .description('Deterministically audit a validated blueprint without starting the engine')
  .option('-b, --blueprint <path>', 'Blueprint path (auto-detect TOML or JSON)')
  .addOption(new Option('--format <format>', 'Report format').choices(['text', 'json']).default('text'))
  .option('--output <path>', 'Write the JSON report to a snapshot file')
  .option('--check <path>', 'Fail if the JSON snapshot differs from the report')
  .addOption(new Option('--fail-on <severity>', 'Fail at or above this severity').choices(['error', 'warning', 'info', 'none']).default('error'))
  .action(auditCommand)

program
  .command('benchmark')
  .description('Run the internal Big Zebra benchmark harness')
  .allowUnknownOption(true)
  .argument('[args...]')
  .action(async (args: string[] = []) => {
    await benchmarkCommand({ args })
  })

// Parse arguments
await program.parseAsync()
