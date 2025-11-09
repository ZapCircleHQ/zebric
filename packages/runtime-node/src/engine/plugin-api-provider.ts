/**
 * PluginAPIProvider
 *
 * Provides the Engine API for plugins, handling:
 * - Database access via QueryExecutor
 * - Authentication and session management
 * - Storage operations (in-memory)
 * - Cache operations (in-memory or Redis)
 * - Workflow triggering
 * - Event emitter access
 * - Blueprint read-only access
 * - Logging utilities
 */

import type { FastifyRequest } from 'fastify'
import { ulid } from 'ulid'
import type { AuthProvider, SessionManager } from '@zebric/runtime-core'
import type { QueryExecutor } from '../database/index.js'
import type { WorkflowManager } from '../workflows/index.js'
import type { CacheInterface } from '../cache/index.js'
import type { AuditLogger } from '../security/index.js'
import { AuditSeverity } from '../security/index.js'
import type { Blueprint, EngineAPI } from '@zebric/runtime-core'
import type { EngineConfig } from '../types/index.js'
import type { PluginAuthToken } from '@zebric/runtime-core'
import { EventEmitter } from 'node:events'

export interface PluginAPIProviderDependencies {
  queryExecutor: QueryExecutor
  authProvider: AuthProvider
  sessionManager: SessionManager
  cache: CacheInterface
  auditLogger: AuditLogger
  workflowManager?: WorkflowManager
  blueprint: Blueprint
  config: EngineConfig
  eventEmitter: EventEmitter
}

/**
 * PluginAPIProvider - Manages plugin API creation and session handling
 */
export class PluginAPIProvider {
  private queryExecutor: QueryExecutor
  private authProvider: AuthProvider
  private sessionManager: SessionManager
  private cache: CacheInterface
  private auditLogger: AuditLogger
  private workflowManager?: WorkflowManager
  private blueprint: Blueprint
  private config: EngineConfig
  private eventEmitter: EventEmitter
  private storageStore = new Map<string, Buffer>()

  constructor(deps: PluginAPIProviderDependencies) {
    this.queryExecutor = deps.queryExecutor
    this.authProvider = deps.authProvider
    this.sessionManager = deps.sessionManager
    this.cache = deps.cache
    this.auditLogger = deps.auditLogger
    this.workflowManager = deps.workflowManager
    this.blueprint = deps.blueprint
    this.config = deps.config
    this.eventEmitter = deps.eventEmitter
  }

  /**
   * Update dependencies (called after reload or subsystem changes)
   */
  updateDependencies(updates: Partial<PluginAPIProviderDependencies>): void {
    if (updates.queryExecutor) this.queryExecutor = updates.queryExecutor
    if (updates.authProvider) this.authProvider = updates.authProvider
    if (updates.sessionManager) this.sessionManager = updates.sessionManager
    if (updates.cache) this.cache = updates.cache
    if (updates.auditLogger) this.auditLogger = updates.auditLogger
    if (updates.workflowManager !== undefined) this.workflowManager = updates.workflowManager
    if (updates.blueprint) this.blueprint = updates.blueprint
    if (updates.config) this.config = updates.config
  }

  /**
   * Get Engine API for plugins
   */
  getEngineAPI(): EngineAPI {
    return {
      // Database access via QueryExecutor
      db: this.queryExecutor,

      // Authentication helpers
      auth: {
        getCurrentUser: async (requestLike: any) => {
          const candidateToken = this.extractApiToken(requestLike?.headers ?? {}, requestLike)
          try {
            if (this.sessionManager) {
              const normalized = this.normalizeRequestForSession(requestLike)
              if (normalized) {
                const session = await this.sessionManager.getSession(normalized as any)
                if (session?.user) {
                  return session.user
                }
              }
            }
          } catch (error) {
            this.auditLogger?.logSuspiciousActivity(
              'plugin.auth.getCurrentUser.error',
              AuditSeverity.WARNING,
              {
                metadata: {
                  message: error instanceof Error ? error.message : String(error),
                },
              }
            )
          }

          if (candidateToken) {
            const pluginUser = await this.resolvePluginUser(candidateToken)
            if (pluginUser) {
              return pluginUser
            }
          }

          return null
        },
        createSession: async (userId: string, options?: { replaceToken?: string }): Promise<PluginAuthToken> => {
          if (options?.replaceToken) {
            await this.revokePluginSession(options.replaceToken)
          }
          return this.issuePluginSession(userId)
        },
        invalidateSession: async (token: string) => {
          await this.revokePluginSession(token)
        },
      },

      // Storage (in-memory implementation)
      storage: {
        upload: async (key: string, data: ArrayBuffer | Uint8Array, _options?: any) => {
          const resolvedKey = key && key.trim().length > 0 ? key : ulid()
          // Convert to Buffer for Node.js storage
          const buffer = data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          this.storageStore.set(resolvedKey, buffer)
          return resolvedKey
        },
        download: async (key: string) => {
          const blob = this.storageStore.get(key)
          if (!blob) {
            throw new Error(`Storage key not found: ${key}`)
          }
          // Convert Buffer to ArrayBuffer for platform-agnostic return
          return blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer
        },
        delete: async (key: string) => {
          this.storageStore.delete(key)
        },
        getUrl: (key: string) => {
          return `memory://${key}`
        },
      },

      // Cache (supports in-memory and Redis)
      cache: {
        get: async <T>(key: string): Promise<T | null> => {
          return await this.cache.get<T>(key)
        },
        set: async (key: string, value: any, ttl?: number) => {
          await this.cache.set(key, value, ttl)
        },
        delete: async (key: string) => {
          await this.cache.delete(key)
        },
        incr: async (key: string) => {
          return await this.cache.incr(key)
        },
        exists: async (key: string) => {
          return await this.cache.exists(key)
        },
        clear: async () => {
          await this.cache.clear()
        },
      },

      // Workflows
      workflows: {
        trigger: async (name: string, context: any) => {
          if (!this.workflowManager) {
            throw new Error('Workflow system not initialized')
          }
          this.workflowManager.trigger(name, context)
        },
      },

      // Event emitter
      on: this.eventEmitter.on.bind(this.eventEmitter),
      emit: this.eventEmitter.emit.bind(this.eventEmitter),

      // Blueprint (read-only)
      blueprint: this.blueprint,

      // Logging
      log: {
        debug: (message: string, meta?: any) => {
          if (this.config.dev?.logLevel === 'debug') {
            console.log('[DEBUG]', message, meta || '')
          }
        },
        info: (message: string, meta?: any) => {
          console.log('[INFO]', message, meta || '')
        },
        warn: (message: string, meta?: any) => {
          console.warn('[WARN]', message, meta || '')
        },
        error: (message: string, meta?: any) => {
          console.error('[ERROR]', message, meta || '')
        },
      },
    }
  }

  /**
   * Normalize request-like object for session management
   */
  private normalizeRequestForSession(requestLike: any): FastifyRequest | null {
    if (!requestLike) {
      return null
    }

    if ((requestLike as FastifyRequest).headers && (requestLike as FastifyRequest).cookies !== undefined) {
      return requestLike as FastifyRequest
    }

    const headers: Record<string, string> = {}
    const sourceHeaders = requestLike.headers

    if (sourceHeaders) {
      if (typeof sourceHeaders.forEach === 'function') {
        sourceHeaders.forEach((value: string, key: string) => {
          headers[key.toLowerCase()] = value
        })
      } else {
        Object.entries(sourceHeaders).forEach(([key, value]) => {
          if (typeof value === 'string') {
            headers[key.toLowerCase()] = value
          } else if (Array.isArray(value)) {
            headers[key.toLowerCase()] = value[0]
          }
        })
      }
    }

    const token = this.extractApiToken(headers, requestLike)
    if (token) {
      const authHeader = headers['authorization']
      if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
        headers['authorization'] = `Bearer ${token}`
      }
    }

    if (Object.keys(headers).length === 0 && !requestLike.cookies) {
      return null
    }

    return {
      headers,
      cookies: requestLike.cookies ?? {},
    } as FastifyRequest
  }

  /**
   * Extract API token from headers or request-like object
   */
  private extractApiToken(headersInput: any, requestLike: any): string | null {
    const lowerCaseHeaders: Record<string, string> = {}

    if (headersInput) {
      if (typeof headersInput.forEach === 'function') {
        headersInput.forEach((value: string, key: string) => {
          lowerCaseHeaders[key.toLowerCase()] = value
        })
      } else {
        Object.entries(headersInput).forEach(([key, value]) => {
          if (typeof value === 'string') {
            lowerCaseHeaders[key.toLowerCase()] = value
          } else if (Array.isArray(value) && value.length > 0) {
            lowerCaseHeaders[key.toLowerCase()] = value[0]
          }
        })
      }
    }

    const authorization = lowerCaseHeaders['authorization']
    if (authorization && typeof authorization === 'string') {
      const normalized = authorization.trim()
      if (normalized.toLowerCase().startsWith('bearer ')) {
        return normalized.slice(7)
      }
      if (normalized.toLowerCase().startsWith('zbl-token ')) {
        return normalized.substring('zbl-token '.length).trim()
      }
    }

    const zblHeader =
      lowerCaseHeaders['zbl-token'] ??
      lowerCaseHeaders['x-api-token'] ??
      lowerCaseHeaders['x-zbl-token'] ??
      lowerCaseHeaders['x-plugin-token']
    if (typeof zblHeader === 'string' && zblHeader.trim()) {
      return zblHeader.trim()
    }

    if (typeof requestLike?.token === 'string') {
      return requestLike.token
    }

    if (typeof requestLike?.sessionToken === 'string') {
      return requestLike.sessionToken
    }

    return null
  }

  /**
   * Issue a plugin session token
   */
  private async issuePluginSession(userId: string): Promise<PluginAuthToken> {
    // Get the underlying Better Auth instance
    const betterAuthInstance = this.authProvider.getAuthInstance()
    const context = await betterAuthInstance.$context
    const headers = typeof Headers !== 'undefined'
      ? new Headers({ 'user-agent': 'zbl-plugin-token' })
      : {
          get: (name: string) => (name.toLowerCase() === 'user-agent' ? 'zbl-plugin-token' : undefined),
        }

    const endpointContext: any = {
      context,
      headers,
      method: 'POST',
      path: '/plugins/token',
    }

    const session = await context.internalAdapter.createSession(
      userId,
      endpointContext,
      false,
      {
        userAgent: 'zbl-plugin-token',
      }
    )

    return {
      id: session.id,
      userId: session.userId,
      token: session.token,
      createdAt: session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt),
      expiresAt: session.expiresAt instanceof Date ? session.expiresAt : new Date(session.expiresAt),
    }
  }

  /**
   * Revoke a plugin session token
   */
  private async revokePluginSession(token: string): Promise<void> {
    // Get the underlying Better Auth instance
    const betterAuthInstance = this.authProvider.getAuthInstance()
    const context = await betterAuthInstance.$context
    await context.internalAdapter.deleteSession(token)
  }

  /**
   * Resolve user from plugin session token
   */
  private async resolvePluginUser(token: string): Promise<any | null> {
    try {
      // Get the underlying Better Auth instance
      const betterAuthInstance = this.authProvider.getAuthInstance()
      const context = await betterAuthInstance.$context
      const result = await context.internalAdapter.findSession(token)
      if (result && result.user) {
        return result.user
      }
    } catch (error) {
      this.auditLogger?.logSuspiciousActivity('plugin.auth.resolve.error', AuditSeverity.WARNING, {
        metadata: {
          token,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
    return null
  }
}
