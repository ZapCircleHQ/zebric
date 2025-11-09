/**
 * Zebric Workers Engine
 *
 * CloudFlare Workers adapter for Zebric runtime.
 */

import { BlueprintParser, detectFormat } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'
import { D1Adapter } from './database/d1-adapter.js'
import { KVCache } from './cache/kv-cache.js'

export interface WorkersEnv {
  // CloudFlare bindings
  DB: D1Database
  CACHE_KV?: KVNamespace
  FILES_R2?: R2Bucket

  // Environment variables
  BLUEPRINT?: string // Serialized blueprint JSON
}

export interface WorkersEngineConfig {
  env: WorkersEnv
  blueprint?: Blueprint // Pre-parsed blueprint
  blueprintContent?: string // Raw blueprint content (JSON/TOML)
  blueprintFormat?: 'json' | 'toml' // Format of blueprintContent
}

export class ZebricWorkersEngine {
  private blueprint!: Blueprint
  private db: D1Adapter
  private cache?: KVCache

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
  }

  /**
   * Handle incoming request
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)

      // Health check endpoint
      if (url.pathname === '/health') {
        return this.handleHealthCheck()
      }

      // API routes
      if (url.pathname.startsWith('/api/')) {
        return this.handleApiRequest(request, url)
      }

      // Page routes
      return this.handlePageRequest(request, url)
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

  private async handleApiRequest(request: Request, url: URL): Promise<Response> {
    // TODO: Implement API request handling
    // This will use the query executor from runtime-core
    return new Response(
      JSON.stringify({
        message: 'API endpoint not yet implemented',
        path: url.pathname
      }),
      {
        status: 501,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  private async handlePageRequest(request: Request, url: URL): Promise<Response> {
    // TODO: Implement page rendering
    // This will use the HTML renderer from runtime-core
    return new Response(
      JSON.stringify({
        message: 'Page rendering not yet implemented',
        path: url.pathname
      }),
      {
        status: 501,
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
