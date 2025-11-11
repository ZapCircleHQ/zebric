/**
 * Dev Command
 *
 * Runs the Zebric Engine in development mode with hot reload.
 */

import { resolve } from 'node:path'
import { ZebricEngine } from '@zebric/runtime-node'

export interface DevOptions {
  blueprint?: string
  port?: number
  host?: string
  seed?: boolean
}

export async function devCommand(options: DevOptions = {}): Promise<void> {
  const blueprintPath = options.blueprint
    ? resolve(process.cwd(), options.blueprint)
    : resolve(process.cwd(), 'blueprint.json')

  const engine = new ZebricEngine({
    blueprintPath,
    port: options.port || 3000,
    host: options.host || 'localhost',
    dev: {
      hotReload: true,
      seed: options.seed,
      logLevel: 'debug',
      logQueries: true,
    },
  })

  // Handle shutdown gracefully
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

  try {
    await engine.start()
  } catch (error) {
    console.error('Failed to start engine:', error)
    process.exit(1)
  }
}
