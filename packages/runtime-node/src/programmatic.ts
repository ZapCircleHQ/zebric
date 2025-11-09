/**
 * Programmatic Runtime API
 *
 * Control Zebric server lifecycle from code for AI tools, testing, and automation.
 */

import { ZebricEngine } from './engine.js'
import type { Blueprint } from '@zebric/runtime-core'
import type { EngineConfig } from './types/index.js'
import type { Theme } from './renderer/theme.js'
import { validateBlueprintFile } from './blueprint/validate.js'

/**
 * Options for creating a Zebric instance
 */
export interface ZebricOptions {
  /**
   * Path to the Blueprint file (TOML or JSON)
   */
  blueprintPath?: string

  /**
   * Server host
   * @default 'localhost'
   */
  host?: string

  /**
   * Server port
   * @default 3000
   */
  port?: number

  /**
   * Database connection URL
   * @default 'sqlite://./data/app.db'
   */
  databaseUrl?: string

  /**
   * Redis URL for caching and sessions
   */
  redisUrl?: string

  /**
   * Enable development mode (hot reload, admin server)
   * @default false
   */
  dev?: boolean

  /**
   * Custom theme
   */
  theme?: Theme

  /**
   * Log level
   */
  logLevel?: 'debug' | 'info' | 'warn' | 'error'

  /**
   * Validate Blueprint before starting
   * @default true
   */
  validateBeforeStart?: boolean
}

/**
 * Zebric instance for programmatic control
 *
 * @example
 * ```typescript
 * import { Zebric } from '@zebric/runtime'
 *
 * const zebric = new Zebric({
 *   blueprintPath: './blueprint.toml',
 *   port: 3000
 * })
 *
 * await zebric.start()
 * // Server is now running
 *
 * await zebric.reload('./new-blueprint.toml')
 * // Server reloaded with new Blueprint
 *
 * await zebric.stop()
 * // Server stopped
 * ```
 */
export class Zebric {
  private engine?: ZebricEngine
  private options: ZebricOptions
  private isRunning = false

  constructor(options: ZebricOptions = {}) {
    this.options = {
      validateBeforeStart: true,
      ...options,
    }
  }

  /**
   * Start the Zebric server
   *
   * @throws Error if Blueprint validation fails
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Zebric is already running')
    }

    if (!this.options.blueprintPath) {
      throw new Error('blueprintPath is required')
    }

    // Validate Blueprint before starting (if enabled)
    if (this.options.validateBeforeStart) {
      try {
        await validateBlueprintFile(this.options.blueprintPath)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`Blueprint validation failed: ${errorMessage}`)
      }
    }

    // Create engine config
    const config: EngineConfig = {
      blueprintPath: this.options.blueprintPath,
      host: this.options.host || 'localhost',
      port: this.options.port || 3000,
      theme: this.options.theme,
    }

    // Add database config if provided
    if (this.options.databaseUrl) {
      config.database = { url: this.options.databaseUrl }
    }

    // Add cache config if provided
    if (this.options.redisUrl) {
      config.cache = { redisUrl: this.options.redisUrl }
    }

    // Add dev config if enabled
    if (this.options.dev) {
      config.dev = {
        hotReload: true,
        dbPath: this.options.databaseUrl?.replace('sqlite://', ''),
        logLevel: this.options.logLevel || 'info',
        adminHost: this.options.host || '127.0.0.1',
        adminPort: (this.options.port || 3000) + 30, // Admin on port + 30
      }
    }

    // Create and start engine
    this.engine = new ZebricEngine(config)
    await this.engine.start()
    this.isRunning = true
  }

  /**
   * Stop the Zebric server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.engine) {
      throw new Error('Zebric is not running')
    }

    await this.engine.stop()
    this.isRunning = false
    this.engine = undefined
  }

  /**
   * Reload the Zebric server with a new Blueprint
   *
   * @param blueprint - Blueprint object to reload (loaded from current blueprintPath if not provided)
   */
  async reload(blueprint?: Blueprint): Promise<void> {
    if (!this.isRunning || !this.engine) {
      throw new Error('Zebric is not running')
    }

    // Reload engine with new Blueprint
    await this.engine.reload(blueprint)
  }

  /**
   * Get the server URL
   */
  getUrl(): string {
    if (!this.isRunning) {
      throw new Error('Zebric is not running')
    }
    const host = this.options.host || 'localhost'
    const port = this.options.port || 3000
    return `http://${host}:${port}`
  }

  /**
   * Get the admin server URL (if in dev mode)
   */
  getAdminUrl(): string | null {
    if (!this.isRunning || !this.options.dev) {
      return null
    }
    const host = this.options.host || 'localhost'
    const port = (this.options.port || 3000) + 30
    return `http://${host}:${port}`
  }

  /**
   * Check if the server is running
   */
  running(): boolean {
    return this.isRunning
  }

  /**
   * Get the underlying ZebricEngine instance
   * Use with caution - for advanced use cases only
   */
  getEngine(): ZebricEngine | undefined {
    return this.engine
  }
}

/**
 * Create and start a Zebric instance in one call
 *
 * @param options - Zebric options
 * @returns Started Zebric instance
 *
 * @example
 * ```typescript
 * import { createZebric } from '@zebric/runtime'
 *
 * const zebric = await createZebric({
 *   blueprintPath: './blueprint.toml',
 *   port: 3000,
 *   dev: true
 * })
 *
 * console.log('Server running at:', zebric.getUrl())
 * ```
 */
export async function createZebric(options: ZebricOptions): Promise<Zebric> {
  const zebric = new Zebric(options)
  await zebric.start()
  return zebric
}

/**
 * Create a Zebric instance for testing
 * Uses in-memory SQLite and random port
 *
 * @param blueprintPath - Path to Blueprint file
 * @returns Started Zebric instance with random port
 *
 * @example
 * ```typescript
 * import { createTestZebric } from '@zebric/runtime'
 *
 * const zebric = await createTestZebric('./test-blueprint.toml')
 * const response = await fetch(`${zebric.getUrl()}/api/users`)
 * await zebric.stop()
 * ```
 */
export async function createTestZebric(
  blueprintPath: string
): Promise<Zebric> {
  const zebric = new Zebric({
    blueprintPath,
    port: 0, // Random port
    databaseUrl: 'sqlite://:memory:', // In-memory database
    dev: false, // No dev mode for tests
  })

  await zebric.start()
  return zebric
}
