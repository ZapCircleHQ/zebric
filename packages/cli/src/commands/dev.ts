/** Runs the Zebric Engine in development mode with hot reload. */
import { BlueprintValidationError } from '@zebric/runtime-core'
import { BlueprintLoader, ZebricEngine } from '@zebric/runtime-node'
import { resolveBlueprintPath } from '../blueprint-path.js'
import { checkBlueprintReadable, checkDevPort, getDevPorts, startupErrorMessage } from '../dev-preflight.js'
import { reportValidationError } from './validate.js'

export interface DevOptions {
  blueprint?: string
  port?: number
  adminPort?: number
  host?: string
  seed?: boolean
}

export async function devCommand(options: DevOptions = {}): Promise<void> {
  let blueprintPath = options.blueprint ?? 'Blueprint'
  try {
    const { port, adminPort } = getDevPorts(options.port, options.adminPort)
    blueprintPath = resolveBlueprintPath(options.blueprint)
    await checkBlueprintReadable(blueprintPath)
    // Validate before constructing the engine or initializing database resources.
    await new BlueprintLoader().load(blueprintPath)
    const host = options.host || 'localhost'
    await checkDevPort(host, port, 'App')
    await checkDevPort('127.0.0.1', adminPort, 'Admin')
    const engine = new ZebricEngine({
      blueprintPath, port, host,
      dev: { adminPort, hotReload: true, seed: options.seed, logLevel: 'debug', logQueries: true },
    })
    const shutdown = async () => {
      console.log('\n\n👋 Shutting down...')
      await engine.stop()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    await engine.start()
  } catch (error) {
    if (error instanceof BlueprintValidationError) reportValidationError(error, blueprintPath)
    else console.error(`Failed to start app: ${startupErrorMessage(error)}`)
    process.exit(1)
  }
}
