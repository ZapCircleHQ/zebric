/**
 * SubsystemInitializer
 *
 * Handles initialization of all engine subsystems:
 * - Database connection and schema
 * - Authentication (Better Auth)
 * - Workflows
 * - Cache (in-memory or Redis)
 */

import type { Blueprint } from '@zebric/runtime-core'
import type { EngineConfig } from '../types/index.js'
import { DatabaseConnection, QueryExecutor } from '../database/index.js'
import { SessionManager, PermissionManager, type AuthProvider, ErrorSanitizer } from '@zebric/runtime-core'
import { createBetterAuthProvider, type AuthProviderConfig } from '../auth/index.js'
import { WorkflowManager, ProductionHttpClient } from '../workflows/index.js'
import { CacheInterface, MemoryCache, RedisCache } from '../cache/index.js'
import type { MetricsRegistry } from '../monitoring/metrics.js'
import type { PluginRegistry } from '../plugins/index.js'
import type { AuditLogger } from '../security/index.js'
import { NotificationManager } from '@zebric/notifications'

export interface SubsystemInitializerDependencies {
  blueprint: Blueprint
  config: EngineConfig
  metrics: MetricsRegistry
  plugins: PluginRegistry
  auditLogger: AuditLogger
  errorSanitizer: ErrorSanitizer
}

export interface InitializedSubsystems {
  database: DatabaseConnection
  queryExecutor: QueryExecutor
  authProvider: AuthProvider
  sessionManager: SessionManager
  permissionManager: PermissionManager
  workflowManager?: WorkflowManager
  cache: CacheInterface
  notificationManager?: NotificationManager
}

/**
 * SubsystemInitializer - Initializes all engine subsystems
 */
export class SubsystemInitializer {
  private blueprint: Blueprint
  private config: EngineConfig
  private metrics: MetricsRegistry
  private plugins: PluginRegistry

  // Initialized subsystems
  private database?: DatabaseConnection
  private queryExecutor?: QueryExecutor
  private authProvider?: AuthProvider
  private sessionManager?: SessionManager
  private permissionManager?: PermissionManager
  private workflowManager?: WorkflowManager
  private cache?: CacheInterface
  private notificationManager?: NotificationManager

  constructor(deps: SubsystemInitializerDependencies) {
    this.blueprint = deps.blueprint
    this.config = deps.config
    this.metrics = deps.metrics
    this.plugins = deps.plugins
  }

  /**
   * Initialize notification adapters
   */
  initializeNotifications(): NotificationManager {
    if (this.notificationManager) {
      return this.notificationManager
    }

    const config = this.blueprint.notifications
    this.notificationManager = new NotificationManager(config)
    console.log(`✅ Notifications initialized (${this.notificationManager.listAdapters().join(', ')})`)
    return this.notificationManager
  }

  /**
   * Update blueprint after reload
   */
  updateBlueprint(blueprint: Blueprint): void {
    this.blueprint = blueprint
  }

  /**
   * Initialize cache based on configuration
   */
  initializeCache(): CacheInterface {
    const redisUrl = this.config.cache?.redisUrl || process.env.REDIS_URL
    const cacheType = this.config.cache?.type || (redisUrl ? 'redis' : 'memory')

    if (cacheType === 'redis' && redisUrl) {
      this.cache = new RedisCache({
        url: redisUrl,
        keyPrefix: this.config.cache?.keyPrefix,
      })
    } else if (cacheType === 'redis' && this.config.cache) {
      this.cache = new RedisCache({
        host: this.config.cache.host,
        port: this.config.cache.port,
        password: this.config.cache.password,
        db: this.config.cache.db,
        keyPrefix: this.config.cache.keyPrefix,
      })
    } else {
      // Default to in-memory cache for development
      this.cache = new MemoryCache()
    }

    return this.cache
  }

  /**
   * Initialize database
   */
  async initializeDatabase(): Promise<{ database: DatabaseConnection; queryExecutor: QueryExecutor }> {
    const dbPath = this.config.dev?.dbPath || './data/app.db'

    this.database = new DatabaseConnection(
      {
        type: 'sqlite',
        filename: dbPath,
      },
      this.blueprint
    )

    await this.database.connect()

    this.queryExecutor = new QueryExecutor(this.database, undefined, this.metrics)

    console.log(`✅ Connected to SQLite database: ${dbPath}`)

    return {
      database: this.database,
      queryExecutor: this.queryExecutor,
    }
  }

  /**
   * Initialize authentication
   */
  async initializeAuth(): Promise<{
    authProvider: AuthProvider
    sessionManager: SessionManager
    permissionManager: PermissionManager
  }> {
    const dbPath = this.config.dev?.dbPath || './data/app.db'
    const host = this.config.host || 'localhost'
    const port = this.config.port || 3000
    const baseURL = `http://${host}:${port}`

    // Create permission manager from Blueprint
    this.permissionManager = new PermissionManager(this.blueprint.auth)

    // Get auth secret from env or generate one
    const secret = process.env.BETTER_AUTH_SECRET || 'development-secret-change-in-production'

    // Get trusted origins from Blueprint or use default
    const blueprintOrigins = this.blueprint.auth?.trustedOrigins || []
    const originSet = new Set<string>([baseURL, ...blueprintOrigins])

    // When binding to 0.0.0.0/:: for dev, also trust localhost variants for callbacks
    if (host === '0.0.0.0' || host === '::') {
      originSet.add(`http://localhost:${port}`)
      originSet.add(`http://127.0.0.1:${port}`)
    }

    const trustedOrigins = Array.from(originSet)

    const authConfig: AuthProviderConfig = {
      databaseUrl: dbPath,
      blueprint: this.blueprint,
      baseURL,
      secret,
      trustedOrigins,
    }

    // Create BetterAuth provider (default implementation)
    this.authProvider = createBetterAuthProvider(authConfig)
    this.sessionManager = new SessionManager(this.authProvider)

    // Update query executor with permission manager
    if (this.queryExecutor) {
      this.queryExecutor.setPermissionManager(this.permissionManager)
    }

    const roles = this.permissionManager.getAllRoles()
    const roleInfo = roles.length > 0 ? ` with roles: ${roles.join(', ')}` : ''
    console.log(`✅ Authentication initialized (${this.blueprint.auth?.providers?.join(', ') || 'email'})${roleInfo}`)

    return {
      authProvider: this.authProvider,
      sessionManager: this.sessionManager,
      permissionManager: this.permissionManager,
    }
  }

  /**
   * Initialize workflows
   */
  async initializeWorkflows(): Promise<WorkflowManager | undefined> {
    // Initialize HTTP client for workflow webhooks
    const httpClient = new ProductionHttpClient({
      timeout: parseInt(process.env.WORKFLOW_HTTP_TIMEOUT || '30000'),
      maxPayloadSize: parseInt(process.env.WORKFLOW_MAX_PAYLOAD_SIZE || String(10 * 1024 * 1024)),
      retries: 3,
      circuitBreakerThreshold: 5,
    })

    // Initialize Workflow Manager
    if (!this.queryExecutor) {
      throw new Error('Query executor must be initialized before workflows')
    }

    this.workflowManager = new WorkflowManager({
      dataLayer: this.queryExecutor,
      pluginRegistry: this.plugins,
      httpClient,
      notificationService: this.notificationManager,
      maxConcurrent: 10,
      retryDelay: 1000,
      maxRetries: 3,
      jobTimeout: 30000,
    })

    // Register workflows from blueprint
    if (this.blueprint.workflows) {
      for (const workflow of this.blueprint.workflows) {
        this.workflowManager.registerWorkflow(workflow as any)
      }
      console.log(`✅ Workflows initialized (${this.blueprint.workflows.length} workflows registered)`)
    } else {
      console.log('✅ Workflows initialized (no workflows configured)')
    }

    // Set up workflow event handlers
    this.workflowManager.on('job:completed', (job) => {
      console.log(`✅ Workflow job completed: ${job.workflowName} (${job.id})`)
    })

    this.workflowManager.on('job:failed', (job) => {
      console.error(`❌ Workflow job failed: ${job.workflowName} (${job.id}) - ${job.error}`)
    })

    return this.workflowManager
  }

  /**
   * Get all initialized subsystems
   */
  getSubsystems(): InitializedSubsystems {
    if (!this.database || !this.queryExecutor || !this.authProvider || !this.sessionManager || !this.permissionManager || !this.cache) {
      throw new Error('Subsystems not fully initialized')
    }

    return {
      database: this.database,
      queryExecutor: this.queryExecutor,
      authProvider: this.authProvider,
      sessionManager: this.sessionManager,
      permissionManager: this.permissionManager,
      workflowManager: this.workflowManager,
      cache: this.cache,
      notificationManager: this.notificationManager,
    }
  }

  /**
   * Cleanup all subsystems
   */
  async cleanup(): Promise<void> {
    if (this.workflowManager) {
      await this.workflowManager.shutdown()
    }

    if (this.database) {
      await this.database.close()
    }

    if (this.cache) {
      await this.cache.close()
    }
  }
}
