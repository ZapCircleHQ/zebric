#!/usr/bin/env node

/**
 * Engine Runner
 *
 * Direct engine runner (zebric-engine command).
 */

import { resolve } from 'node:path'
import { ZebricEngine } from '@zebric/runtime-node'

function parseIntegerEnv(name: string): number | undefined {
  const value = process.env[name]
  if (!value) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function printHelp(): void {
  console.log(`Usage: zebric-engine [options]

Options:
  --blueprint <path>  Path to the blueprint file (default: blueprint.json)
  --port <number>     Port to listen on (default: 3000)
  --host <host>       Host to bind to (default: 0.0.0.0)
  -h, --help          Display help
`)
}

// Parse command line arguments
const args = process.argv.slice(2)
const options: Record<string, string> = {}

if (args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(0)
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg.startsWith('--')) {
    const argWithoutDashes = arg.slice(2)

    // Handle --key=value format
    if (argWithoutDashes.includes('=')) {
      const [key, ...valueParts] = argWithoutDashes.split('=')
      options[key] = valueParts.join('=')
    }
    // Handle --key value format
    else {
      const key = argWithoutDashes
      const value = args[i + 1]
      if (value && !value.startsWith('--')) {
        options[key] = value
        i++
      } else {
        options[key] = 'true'
      }
    }
  }
}

// Get configuration
const blueprintPath = options.blueprint
  ? resolve(process.cwd(), options.blueprint)
  : resolve(process.cwd(), 'blueprint.json')

const port = options.port !== undefined ? parseInt(options.port, 10) : 3000
const host = options.host || '0.0.0.0'
const adminPort = port === 0 ? 0 : port + 30
const rateLimitMax = parseIntegerEnv('ZEBRIC_RATE_LIMIT_MAX')
const rateLimitWindowMs = parseIntegerEnv('ZEBRIC_RATE_LIMIT_WINDOW_MS')
const databaseUrl = process.env.DATABASE_URL

const rateLimit =
  rateLimitMax !== undefined || rateLimitWindowMs !== undefined
    ? {
        ...(rateLimitMax !== undefined ? { max: rateLimitMax } : {}),
        ...(rateLimitWindowMs !== undefined ? { windowMs: rateLimitWindowMs } : {}),
      }
    : undefined

// Create engine
const engine = new ZebricEngine({
  blueprintPath,
  port,
  host,
  ...(databaseUrl ? { database: { url: databaseUrl } } : {}),
  dev: {
    adminPort,
    hotReload: true, // Enable hot reload
    logLevel: 'debug',
    logQueries: true,
    ...(rateLimit ? { rateLimit } : {}),
  },
})

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down...')
  await engine.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n\n👋 Shutting down...')
  await engine.stop()
  process.exit(0)
})

// Start engine
engine.start().catch((error) => {
  console.error('Failed to start engine:', error)
  process.exit(1)
})
