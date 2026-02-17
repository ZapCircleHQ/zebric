/**
 * Engine Lifecycle
 *
 * Standalone functions for graceful shutdown, hot reload setup, and plugin loading.
 */

import type { ServerType } from '@hono/node-server'
import type { Blueprint, EngineAPI } from '@zebric/runtime-core'
import type { PluginRegistry } from './plugins/index.js'
import type { BlueprintWatcher, ReloadServer } from './hot-reload/index.js'
import type { HTMLRenderer } from './renderer/index.js'
import { getReloadScript } from './hot-reload/index.js'
import { PluginAPIProvider } from './engine/index.js'
import type { QueryExecutor } from './database/index.js'
import type { SessionManager, AuthProvider } from '@zebric/runtime-core'
import type { AuditLogger } from './security/index.js'
import type { CacheInterface } from './cache/index.js'
import type { WorkflowManager } from './workflows/index.js'
import type { EngineConfig } from './types/index.js'
import { EventEmitter } from 'node:events'

/**
 * Setup graceful shutdown handlers for SIGTERM and SIGINT
 */
export function setupGracefulShutdown(
  stopFn: () => Promise<void>,
  shutdownTimeout: number
): void {
  let isShuttingDown = false

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    console.log(`\n⚠️  Received ${signal}, starting graceful shutdown...`)

    // Set a timeout to force shutdown if graceful shutdown takes too long
    const forceShutdownTimer = setTimeout(() => {
      console.error('❌ Graceful shutdown timed out, forcing exit')
      process.exit(1)
    }, shutdownTimeout)

    try {
      await stopFn()
      clearTimeout(forceShutdownTimer)
      process.exit(0)
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error)
      clearTimeout(forceShutdownTimer)
      process.exit(1)
    }
  }

  // Handle SIGTERM (e.g., from Docker, Kubernetes)
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

  // Handle SIGINT (e.g., Ctrl+C)
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error)
    gracefulShutdown('uncaughtException')
  })

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection at:', promise, 'reason:', reason)
    gracefulShutdown('unhandledRejection')
  })
}

export interface HotReloadDeps {
  server: ServerType
  blueprintPath: string
  rendererInstance?: HTMLRenderer
  reloadCallback: (blueprint: Blueprint) => Promise<void>
  errorCallback: (error: Error) => void
}

export interface HotReloadResult {
  watcher: BlueprintWatcher
  reloadServer: ReloadServer
}

/**
 * Setup hot reload (development mode only)
 */
export async function setupHotReload(deps: HotReloadDeps): Promise<HotReloadResult> {
  const { BlueprintWatcher: BWClass, ReloadServer: RSClass } = await import('./hot-reload/index.js')

  const reloadServer = new RSClass({
    server: deps.server as any,
    path: '/__reload',
  })

  // Inject reload script into HTML renderer
  const reloadScript = getReloadScript()
  if (deps.rendererInstance && typeof deps.rendererInstance.setReloadScript === 'function') {
    deps.rendererInstance.setReloadScript(reloadScript)
  }

  // Initialize BlueprintWatcher
  const blueprintWatcher = new BWClass({
    blueprintPath: deps.blueprintPath,
    onReload: deps.reloadCallback,
    onError: deps.errorCallback,
  })

  // Start watching
  blueprintWatcher.start()

  console.log('✅ Hot reload enabled')

  return { watcher: blueprintWatcher, reloadServer }
}

/**
 * Load plugins defined in Blueprint
 */
export async function loadPlugins(
  blueprint: Blueprint,
  plugins: PluginRegistry,
  engineAPI: EngineAPI
): Promise<void> {
  if (!blueprint.plugins || blueprint.plugins.length === 0) {
    console.log('ℹ️  No plugins configured')
    return
  }

  for (const pluginDef of blueprint.plugins) {
    if (!pluginDef.enabled) {
      console.log(`⏭️  Skipping disabled plugin: ${pluginDef.name}`)
      continue
    }

    try {
      await plugins.load(pluginDef.name, pluginDef, engineAPI)
    } catch (error) {
      console.error(`Failed to load plugin ${pluginDef.name}:`, error)
      // Continue loading other plugins
    }
  }

  console.log(`✅ Loaded ${plugins.count()} plugins`)
}

export interface PluginAPIDeps {
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
 * Initialize plugin API provider
 */
export function initializePluginAPIProvider(deps: PluginAPIDeps): PluginAPIProvider {
  return new PluginAPIProvider({
    queryExecutor: deps.queryExecutor,
    authProvider: deps.authProvider,
    sessionManager: deps.sessionManager,
    cache: deps.cache,
    auditLogger: deps.auditLogger,
    workflowManager: deps.workflowManager,
    blueprint: deps.blueprint,
    config: deps.config,
    eventEmitter: deps.eventEmitter,
  })
}
