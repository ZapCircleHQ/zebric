/**
 * Engine Types
 *
 * Core types for the Zebric Engine runtime.
 */

import type { Blueprint, Theme, HTMLRenderer } from '@zebric/runtime-core'
import type { SchemaDiffResult } from '../database/schema-diff.js'

export interface EngineConfig {
  blueprintPath: string
  port?: number
  host?: string
  database?: DatabaseConfig
  cache?: CacheConfig
  dev?: DevConfig
  theme?: Theme
  rendererClass?: typeof HTMLRenderer
}

export interface DatabaseConfig {
  type?: 'sqlite' | 'postgres'
  url?: string
  // SQLite specific
  filename?: string
  // Postgres specific
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}

export interface CacheConfig {
  type?: 'memory' | 'redis'
  redisUrl?: string
  host?: string
  port?: number
  password?: string
  db?: number
  keyPrefix?: string
}

export interface DevConfig {
  hotReload?: boolean
  seed?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  logQueries?: boolean
  dbPath?: string
  adminHost?: string // Admin server host (default: 127.0.0.1)
  adminPort?: number // Admin server port (default: 3030)
  rateLimit?: {
    max?: number
    windowMs?: number
  }
}

export interface EngineState {
  status: 'starting' | 'running' | 'reloading' | 'stopping' | 'stopped'
  startedAt?: Date
  blueprint?: Blueprint
  version: string
  pendingSchemaDiff?: SchemaDiffResult | null
}

export interface HealthStatus {
  healthy: boolean
  database: boolean
  redis?: boolean
  plugins: boolean
  uptime: number
  memory: NodeJS.MemoryUsage
}

export interface Session {
  id: string
  userId: string
  user: any
  expiresAt: Date
  createdAt: Date
}

export interface ZebricEngineAPI {
  getState(): EngineState
  getBlueprint(): Blueprint
  getHealthStatus(): Promise<HealthStatus>
}
