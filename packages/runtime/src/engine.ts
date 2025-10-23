/**
 * Zebric Runtime Engine (ZBL)
 *
 * Main engine class that interprets Blueprint JSON at runtime.
 */

import type { FastifyInstance } from 'fastify'
import { EventEmitter } from 'node:events'
import { BlueprintLoader } from './blueprint/index.js'
import { PluginRegistry } from './plugins/index.js'
import { RouteMatcher, RouteHandler } from './server/index.js'
import { DatabaseConnection, QueryExecutor, SchemaDiffer, type SchemaDiffResult } from './database/index.js'
import { SessionManager } from './auth/index.js'
import { AuditLogger, ErrorSanitizer } from './security/index.js'
import { BlueprintWatcher, ReloadServer, getReloadScript } from './hot-reload/index.js'
import type { WorkflowManager } from './workflows/index.js'
import { MetricsRegistry, type MetricSnapshot } from './monitoring/metrics.js'
import { RequestTracer } from './monitoring/request-tracer.js'
import type { CacheInterface } from './cache/index.js'
import { ErrorHandler } from './errors/index.js'
import type { AuthProvider } from './auth/index.js'
import { PluginAPIProvider, SubsystemInitializer, ServerManager, AdminServer } from './engine/index.js'
import { FileStorage } from './storage/index.js'
import type {
  Blueprint,
  EngineConfig,
  EngineState,
  HealthStatus,
  EngineAPI,
} from './types/index.js'

const ENGINE_VERSION = '0.1.1'

export class ZebricEngine extends EventEmitter {
  private state: EngineState
  private blueprint!: Blueprint
  private loader: BlueprintLoader
  private plugins: PluginRegistry
  private server!: FastifyInstance
  private config: EngineConfig
  private routeMatcher: RouteMatcher
  private routeHandler: RouteHandler
  private database!: DatabaseConnection
  private queryExecutor!: QueryExecutor
  private authProvider!: AuthProvider
  public sessionManager!: SessionManager
  private auditLogger!: AuditLogger
  private errorSanitizer!: ErrorSanitizer
  private errorHandler!: ErrorHandler
  private blueprintWatcher?: BlueprintWatcher
  private reloadServer?: ReloadServer
  private workflowManager?: WorkflowManager
  private metrics: MetricsRegistry
  private tracer: RequestTracer
  private cache!: CacheInterface
  private pluginAPIProvider!: PluginAPIProvider
  private subsystemInitializer!: SubsystemInitializer
  private serverManager!: ServerManager
  private adminServer?: AdminServer
  private fileStorage!: FileStorage
  private pendingSchemaDiff: SchemaDiffResult | null = null
  private isShuttingDown = false
  private shutdownTimeout = 30000 // 30 seconds

  constructor(config: EngineConfig) {
    super()

    this.config = config
    this.state = {
      status: 'starting',
      version: ENGINE_VERSION,
      pendingSchemaDiff: null,
    }

    this.loader = new BlueprintLoader()
    this.plugins = new PluginRegistry()
    this.routeMatcher = new RouteMatcher()
    const host = config.host && config.host !== '0.0.0.0' && config.host !== '::'
      ? config.host
      : 'localhost'
    const port = config.port || 3000
    const defaultOrigin = `http://${host}:${port}`

    this.fileStorage = new FileStorage()

    this.routeHandler = new RouteHandler(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      this.plugins,
      defaultOrigin,
      config.theme,
      config.rendererClass,
      this.fileStorage
    ) // Will set blueprint after loading
    this.metrics = new MetricsRegistry()
    this.tracer = new RequestTracer()

    // Initialize security modules
    this.auditLogger = new AuditLogger({
      logPath: config.dev?.dbPath ? config.dev.dbPath.replace(/\.db$/, '.audit.log') : './data/audit.log',
      enabled: true,
      splitLogs: config.dev?.logLevel !== 'debug', // Separate logs in production
    })

    this.errorSanitizer = new ErrorSanitizer(process.env.NODE_ENV !== 'production')

    // Initialize error handler
    this.errorHandler = new ErrorHandler({
      sanitizer: this.errorSanitizer,
    })
  }

  /**
   * Start the engine
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Zebric Engine...\n')

    try {
      this.state.status = 'starting'

      // 1. Load Blueprint
      await this.loadBlueprint()

      // 2. Initialize SubsystemInitializer
      this.subsystemInitializer = new SubsystemInitializer({
        blueprint: this.blueprint,
        config: this.config,
        metrics: this.metrics,
        plugins: this.plugins,
        auditLogger: this.auditLogger,
        errorSanitizer: this.errorSanitizer,
      })

      // 3. Initialize Cache
      this.cache = this.subsystemInitializer.initializeCache()

      // 4. Initialize Database
      const { database, queryExecutor } = await this.subsystemInitializer.initializeDatabase()
      this.database = database
      this.queryExecutor = queryExecutor

      // Update route handler with database
      this.routeHandler.setBlueprint(this.blueprint, this.config.blueprintPath)
      this.routeHandler.setQueryExecutor(this.queryExecutor)

      // 5. Initialize Authentication
      const { authProvider, sessionManager } = await this.subsystemInitializer.initializeAuth()
      this.authProvider = authProvider
      this.sessionManager = sessionManager
      // permissionManager is used internally by subsystem initializer

      // Update route handler with session manager and security modules
      this.routeHandler.setSessionManager(this.sessionManager)
      this.routeHandler.setAuditLogger(this.auditLogger)
      this.routeHandler.setErrorSanitizer(this.errorSanitizer)
      this.routeHandler.setPluginRegistry(this.plugins)

      // 6. Initialize Workflows
      this.workflowManager = await this.subsystemInitializer.initializeWorkflows()

      // 7. Initialize File Storage
      await this.fileStorage.initialize()

      // 8. Initialize Plugin API Provider
      this.initializePluginAPIProvider()

      // 8. Load Plugins (after core systems are initialized)
      await this.loadPlugins()

      // 9. Initialize and Start HTTP Server
      this.serverManager = new ServerManager({
        blueprint: this.blueprint,
        config: this.config,
        state: this.state,
        authProvider: this.authProvider,
        sessionManager: this.sessionManager,
        queryExecutor: this.queryExecutor,
        workflowManager: this.workflowManager,
        plugins: this.plugins,
        routeMatcher: this.routeMatcher,
        routeHandler: this.routeHandler,
        metrics: this.metrics,
        tracer: this.tracer,
        errorHandler: this.errorHandler,
        pendingSchemaDiff: this.pendingSchemaDiff,
        getHealthStatus: () => this.getHealth(),
      })

      this.server = await this.serverManager.start()

      // 10. Start Admin Server (if in dev mode)
      if (this.config.dev) {
        const adminHost = this.config.dev.adminHost || '127.0.0.1'
        // If adminPort is explicitly set (including 0), use it
        // Otherwise use 3030 as default
        const adminPort = this.config.dev.adminPort !== undefined
          ? this.config.dev.adminPort
          : 3030

        this.adminServer = new AdminServer({
          blueprint: this.blueprint,
          state: this.state,
          plugins: this.plugins,
          tracer: this.tracer,
          metrics: this.metrics,
          pendingSchemaDiff: this.pendingSchemaDiff,
          getHealthStatus: () => this.getHealth(),
          host: adminHost,
          port: adminPort,
        })

        await this.adminServer.start()
      }

      // 11. Setup Hot Reload (if in dev mode)
      if (this.config.dev?.hotReload) {
        await this.setupHotReload()
      }

      this.state.status = 'running'
      this.state.startedAt = new Date()

      // Setup graceful shutdown handlers
      this.setupGracefulShutdown()

      console.log('\n✅ Engine ready!')
      console.log(`📱 Server: http://${this.config.host || 'localhost'}:${this.config.port}`)
      if (this.config.dev && this.adminServer) {
        // Get the actual port the admin server is listening on
        const adminServerInstance = this.adminServer.getServer()
        const address = adminServerInstance.server.address()
        if (address && typeof address === 'object') {
          const adminHost = address.address === '::' ? 'localhost' : address.address
          console.log(`📊 Admin: http://${adminHost}:${address.port}`)
        }
      }
      console.log()
    } catch (error) {
      console.error('❌ Failed to start engine:', error)
      this.state.status = 'stopped'
      throw error
    }
  }

  /**
   * Stop the engine
   */
  async stop(): Promise<void> {
    // Prevent multiple shutdown attempts
    if (this.isShuttingDown) {
      return
    }
    this.isShuttingDown = true

    console.log('👋 Stopping Zebric Engine...')

    this.state.status = 'stopping'

    if (this.blueprintWatcher) {
      await this.blueprintWatcher.stop()
    }

    if (this.reloadServer) {
      await this.reloadServer.close()
    }

    if (this.adminServer) {
      await this.adminServer.stop()
    }

    if (this.serverManager) {
      await this.serverManager.stop()
    }

    if (this.subsystemInitializer) {
      await this.subsystemInitializer.cleanup()
    }

    this.state.status = 'stopped'
    console.log('✅ Engine stopped')
  }

  /**
   * Setup graceful shutdown handlers for SIGTERM and SIGINT
   */
  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n⚠️  Received ${signal}, starting graceful shutdown...`)

      // Set a timeout to force shutdown if graceful shutdown takes too long
      const forceShutdownTimer = setTimeout(() => {
        console.error('❌ Graceful shutdown timed out, forcing exit')
        process.exit(1)
      }, this.shutdownTimeout)

      try {
        await this.stop()
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

  /**
   * Reload Blueprint (hot reload)
   */
  async reload(newBlueprint?: Blueprint): Promise<void> {
    console.log('🔄 Reloading Blueprint...')

    this.state.status = 'reloading'

    try {
      // Load new blueprint if not provided
      if (!newBlueprint) {
        newBlueprint = await this.loader.load(this.config.blueprintPath)
      }

      // Validate version compatibility
      this.loader.validateVersion(newBlueprint, ENGINE_VERSION)

      // Update blueprint
      const oldBlueprint = this.blueprint
      let schemaDiff = SchemaDiffer.diff(oldBlueprint, newBlueprint)

      if (schemaDiff.hasChanges) {
        try {
          schemaDiff = await this.database.applySchemaDiff(schemaDiff, newBlueprint)
        } catch (error) {
          console.error('Failed to apply schema changes automatically:', error)
        }

        const changeSummary = [
          schemaDiff.entitiesAdded.length > 0 ? `${schemaDiff.entitiesAdded.length} entities added` : null,
          schemaDiff.entitiesRemoved.length > 0 ? `${schemaDiff.entitiesRemoved.length} entities removed` : null,
          schemaDiff.fieldsAdded.length > 0 ? `${schemaDiff.fieldsAdded.length} fields added` : null,
          schemaDiff.fieldsRemoved.length > 0 ? `${schemaDiff.fieldsRemoved.length} fields removed` : null,
          schemaDiff.fieldsChanged.length > 0 ? `${schemaDiff.fieldsChanged.length} fields modified` : null,
        ]
          .filter(Boolean)
          .join(', ')

        if (schemaDiff.hasChanges) {
          const prefix = schemaDiff.hasBreakingChanges
            ? '⚠️  Schema changes require manual migration'
            : 'ℹ️  Schema changes pending'
          console.warn(`${prefix}: ${changeSummary || 'no summary available'}`)
          this.pendingSchemaDiff = schemaDiff
          this.state.pendingSchemaDiff = schemaDiff
        } else {
          this.pendingSchemaDiff = null
          this.state.pendingSchemaDiff = null
        }
      } else {
        this.pendingSchemaDiff = null
        this.state.pendingSchemaDiff = null
        await this.database.applySchemaDiff(schemaDiff, newBlueprint) // ensure connection blueprint updates
      }

      this.blueprint = newBlueprint
      this.state.blueprint = newBlueprint

      // Update plugin API provider with new blueprint
      if (this.pluginAPIProvider) {
        this.pluginAPIProvider.updateDependencies({ blueprint: newBlueprint })
      }

      // Update route matcher with new pages
      this.routeMatcher = new RouteMatcher()

      // Update route handler with new blueprint
      this.routeHandler.setBlueprint(newBlueprint, this.config.blueprintPath)

      // Notify connected clients via WebSocket
      if (this.reloadServer) {
        this.reloadServer.notifyReload([this.config.blueprintPath])
      }

      // Emit reload event
      this.emit('blueprint:reload', {
        old: oldBlueprint,
        new: newBlueprint,
        timestamp: new Date(),
      })

      this.state.status = 'running'
      console.log('✅ Reload complete')
    } catch (error) {
      console.error('❌ Reload failed:', error)

      // Notify clients of error
      if (this.reloadServer) {
        this.reloadServer.notifyError(error instanceof Error ? error.message : String(error))
      }

      this.state.status = 'running' // Revert to running with old blueprint
      throw error
    }
  }

  /**
   * Get current Blueprint
   */
  getBlueprint(): Blueprint {
    return this.blueprint
  }

  /**
   * Get engine state
   */
  getState(): EngineState {
    return this.state
  }

  /**
   * Get engine version
   */
  getVersion(): string {
    return ENGINE_VERSION
  }

  /**
   * Get health status
   */
  async getHealth(): Promise<HealthStatus> {
    const databaseHealthy = this.database ? await this.database.healthCheck() : false

    return {
      healthy: this.state.status === 'running' && databaseHealthy,
      database: databaseHealthy,
      plugins: this.plugins.count() >= 0,
      uptime: this.state.startedAt
        ? Date.now() - this.state.startedAt.getTime()
        : 0,
      memory: process.memoryUsage(),
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): MetricSnapshot {
    return this.metrics.getSnapshot()
  }

  /**
   * Get Engine API for plugins
   */
  private getEngineAPI(): EngineAPI {
    return this.pluginAPIProvider.getEngineAPI()
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Load Blueprint from filesystem
   */
  private async loadBlueprint(): Promise<void> {
    this.blueprint = await this.loader.load(this.config.blueprintPath)
    this.state.blueprint = this.blueprint
    this.pendingSchemaDiff = null
    this.state.pendingSchemaDiff = null

    // Validate version compatibility
    this.loader.validateVersion(this.blueprint, ENGINE_VERSION)

    console.log(`✅ Loaded Blueprint: ${this.blueprint.project.name} v${this.blueprint.project.version}`)
  }

  /**
   * Load plugins defined in Blueprint
   */
  private async loadPlugins(): Promise<void> {
    if (!this.blueprint.plugins || this.blueprint.plugins.length === 0) {
      console.log('ℹ️  No plugins configured')
      return
    }

    const engineAPI = this.getEngineAPI()

    for (const pluginDef of this.blueprint.plugins) {
      if (!pluginDef.enabled) {
        console.log(`⏭️  Skipping disabled plugin: ${pluginDef.name}`)
        continue
      }

      try {
        await this.plugins.load(pluginDef.name, pluginDef, engineAPI)
      } catch (error) {
        console.error(`Failed to load plugin ${pluginDef.name}:`, error)
        // Continue loading other plugins
      }
    }

    console.log(`✅ Loaded ${this.plugins.count()} plugins`)
  }

  /**
   * Initialize plugin API provider (after auth and cache are ready)
   */
  private initializePluginAPIProvider(): void {
    this.pluginAPIProvider = new PluginAPIProvider({
      queryExecutor: this.queryExecutor,
      authProvider: this.authProvider,
      sessionManager: this.sessionManager,
      cache: this.cache,
      auditLogger: this.auditLogger,
      workflowManager: this.workflowManager,
      blueprint: this.blueprint,
      config: this.config,
      eventEmitter: this,
    })
  }

  /**
   * Setup hot reload (development mode only)
   */
  private async setupHotReload(): Promise<void> {
    // Initialize ReloadServer with WebSocket
    this.reloadServer = new ReloadServer({
      server: (this.server as any).server, // Access underlying HTTP server
      path: '/__reload',
    })

    // Inject reload script into HTML renderer
    const reloadScript = getReloadScript()
    const renderer = (this.routeHandler as any).renderer
    if (renderer && typeof renderer.setReloadScript === 'function') {
      renderer.setReloadScript(reloadScript)
    }

    // Initialize BlueprintWatcher
    this.blueprintWatcher = new BlueprintWatcher({
      blueprintPath: this.config.blueprintPath,
      onReload: async (blueprint) => {
        await this.reload(blueprint)
      },
      onError: (error) => {
        console.error('Blueprint watcher error:', error)
        if (this.reloadServer) {
          this.reloadServer.notifyError(error.message)
        }
      },
    })

    // Start watching
    this.blueprintWatcher.start()

    console.log('✅ Hot reload enabled')
  }
}
