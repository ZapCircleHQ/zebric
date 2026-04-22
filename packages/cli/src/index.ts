#!/usr/bin/env node

/**
 * Zebric CLI
 *
 * Command-line interface for Zebric Engine (ZBL Runtime).
 */

import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { benchmarkCommand, devCommand, validateCommand } from './commands/index.js'

function getCliVersion(): string {
  const packageJsonUrl = new URL('../package.json', import.meta.url)
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as { version?: string }
  return packageJson.version ?? '0.0.0'
}

const program = new Command()

program
  .name('zebric')
  .description('Zebric - Runtime interpreter for Blueprint JSON (ZBL Engine)')
  .version(getCliVersion())

// Dev command
program
  .command('dev')
  .description('Start development server with hot reload')
  .option('-b, --blueprint <path>', 'Path to blueprint.json', 'blueprint.json')
  .option('-p, --port <number>', 'Port to listen on', '3000')
  .option('-h, --host <host>', 'Host to bind to', 'localhost')
  .option('--seed', 'Seed database with sample data')
  .action(async (options) => {
    await devCommand({
      blueprint: options.blueprint,
      port: parseInt(options.port),
      host: options.host,
      seed: options.seed,
    })
  })

// Validate command
program
  .command('validate')
  .description('Validate a blueprint file without starting the engine')
  .option('-b, --blueprint <path>', 'Path to blueprint file', 'blueprint.toml')
  .action(async (options) => {
    await validateCommand({
      blueprint: options.blueprint,
    })
  })

program
  .command('benchmark')
  .description('Run the internal Big Zebra benchmark harness')
  .allowUnknownOption(true)
  .argument('[args...]')
  .action(async (args: string[] = []) => {
    await benchmarkCommand({ args })
  })

// Parse arguments
program.parse()
