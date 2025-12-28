/**
 * Zebric Workers Engine
 *
 * CloudFlare Workers adapter for Zebric runtime.
 */

import { BlueprintParser, detectFormat, HTMLRenderer, defaultTheme } from '@zebric/runtime-core'
import type { Blueprint, Theme } from '@zebric/runtime-core'
import { Hono } from 'hono'
import { D1Adapter } from './database/d1-adapter.js'
import { KVCache } from './cache/kv-cache.js'
import { WorkersSessionManager } from './session/session-manager.js'
import { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { WorkersQueryExecutor } from './query/workers-query-executor.js'

export interface WorkersEnv {
  // CloudFlare bindings
  DB: D1Database
  CACHE_KV?: KVNamespace
  FILES_R2?: R2Bucket
  SESSION_KV?: KVNamespace

  // Environment variables
  BLUEPRINT?: string // Serialized blueprint JSON
  SESSION_SECRET?: string // Secret for session encryption
}

export interface WorkersEngineConfig {
  env: WorkersEnv
  blueprint?: Blueprint // Pre-parsed blueprint
  blueprintContent?: string // Raw blueprint content (JSON/TOML)
  blueprintFormat?: 'json' | 'toml' // Format of blueprintContent
  theme?: Theme // Custom theme (defaults to defaultTheme)
  renderer?: HTMLRenderer // Custom renderer
}

export class ZebricWorkersEngine {
  private blueprint!: Blueprint
  private db: D1Adapter
  private cache?: KVCache
  private adapter: BlueprintHttpAdapter
  private app: Hono

  constructor(private config: WorkersEngineConfig) {
    this.db = new D1Adapter(config.env.DB)

    if (config.env.CACHE_KV) {
      this.cache = new KVCache(config.env.CACHE_KV)
    }

    // Initialize blueprint
    if (config.blueprint) {
      this.blueprint = config.blueprint
    } else if (config.blueprintContent) {
      const parser = new BlueprintParser()
      const format = config.blueprintFormat || detectFormat('blueprint.' + (config.blueprintFormat || 'yaml'))
      this.blueprint = parser.parse(config.blueprintContent, format, 'inline')
    } else if (config.env.BLUEPRINT) {
      const parser = new BlueprintParser()
      this.blueprint = parser.parse(config.env.BLUEPRINT, 'json', 'env:BLUEPRINT')
    } else {
      throw new Error('Blueprint must be provided via config.blueprint, config.blueprintContent, or env.BLUEPRINT')
    }

    // Initialize session manager if SESSION_KV is provided
    let sessionManager: WorkersSessionManager | undefined
    if (config.env.SESSION_KV) {
      sessionManager = new WorkersSessionManager({
        kv: config.env.SESSION_KV
      })
    }

    // Initialize renderer if not provided
    const renderer = config.renderer || new HTMLRenderer(
      this.blueprint,
      config.theme || defaultTheme
    )

    const queryExecutor = new WorkersQueryExecutor(this.db, this.blueprint)
    const rendererPort = {
      renderPage: (context: any) => renderer.renderPage(context)
    }

    // Initialize adapter
    this.adapter = new BlueprintHttpAdapter({
      blueprint: this.blueprint,
      queryExecutor,
      sessionManager,
      renderer: rendererPort
    })

    this.app = new Hono()

    this.app.get('/health', async () => this.handleHealthCheck())

    this.app.all('*', async (c) => {
      return this.adapter.handle(c.req.raw)
    })
  }

  /**
   * Handle incoming request
   */
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.app.fetch(request, this.config.env)
    } catch (error) {
      console.error('Request handling error:', error)
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : String(error)
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
  }

  private async handleHealthCheck(): Promise<Response> {
    const dbHealthy = await this.db.healthCheck()

    return new Response(
      JSON.stringify({
        status: dbHealthy ? 'healthy' : 'degraded',
        database: dbHealthy,
        timestamp: new Date().toISOString()
      }),
      {
        status: dbHealthy ? 200 : 503,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  /**
   * Get the blueprint
   */
  getBlueprint(): Blueprint {
    return this.blueprint
  }

  /**
   * Get the database adapter
   */
  getDatabase(): D1Adapter {
    return this.db
  }

  /**
   * Get the cache adapter (if configured)
   */
  getCache(): KVCache | undefined {
    return this.cache
  }
}

/**
 * Create a Workers fetch handler
 */
export function createWorkerHandler(config: Omit<WorkersEngineConfig, 'env'>) {
  return {
    async fetch(request: Request, env: WorkersEnv, ctx: ExecutionContext): Promise<Response> {
      const engine = new ZebricWorkersEngine({ ...config, env })
      return engine.fetch(request)
    }
  }
}
