/**
 * Zebric Workers Engine
 *
 * CloudFlare Workers adapter for Zebric runtime.
 */

import { BlueprintParser, CommandExecutor, MetricsRegistry, instrumentQueries, ServiceRegistry, DomainError, ValidationFailureError, commandOperationId, detectFormat, ErrorSanitizer, HTMLRenderer, SessionManager, defaultTheme, getInjectedCsrfTokenFromRequest, injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { AuthProvider, Blueprint, Command, CommandHandler, EngineAPI, Plugin, SessionManagerPort, TemplateLoader, Theme, UserSession } from '@zebric/runtime-core'
import { Hono } from 'hono'
import { createPortableNotificationManager, type AdapterFactory, type NotificationManager } from '@zebric/notifications/portable'
import { WorkersSecurityAudit } from './audit/security-audit.js'
import { R2EmailOutbox } from './notifications/r2-email-outbox.js'
import { BundledPluginRegistry } from './plugins/bundled-plugins.js'
import { D1Adapter } from './database/d1-adapter.js'
import { KVCache } from './cache/kv-cache.js'
import { WorkersSessionManager } from './session/session-manager.js'
import { WorkersCookieManager } from './session/cookie-manager.js'
import { BlueprintHttpAdapter, registerWidgetRoutes, registerSearchRoutes } from '@zebric/runtime-hono'
import { WorkersQueryExecutor } from './query/workers-query-executor.js'
import { BundledTemplateLoader } from './renderer/bundled-template-loader.js'
import { KVTemplateLoader } from './renderer/kv-template-loader.js'
import { WorkersBetterAuthProvider } from './auth/better-auth-provider.js'
import { WorkersApiKeyRegistry, agentHasScopes } from './auth/api-key-auth.js'
import { R2Storage } from './storage/r2-storage.js'
import { registerWorkersDiscoveryRoutes } from './api/discovery.js'
import { D1RuntimeJournal } from './audit/d1-runtime-journal.js'
import { registerJournalRoutes } from './api/journal-routes.js'
import { requestFingerprint, WorkersIdempotencyCache } from './api/idempotency-cache.js'
import { D1IdempotencyConflict, D1TransactionConflict } from './database/d1-transactions.js'
import { verifyWebhookRequest } from './security/webhook-auth.js'
import type { DurableWorkflowBinding } from './workflows/durable-workflow.js'
import { type WorkersWorkflowServices, D1WorkflowExecutor, securityId } from './workflows/d1-workflow-executor.js'

export interface WorkersEnv {
  // CloudFlare bindings
  DB: D1Database
  /** Optional Cloudflare Workflows binding for durable workflow execution. */
  WORKFLOWS?: DurableWorkflowBinding
  /** Creates the cache returned by getCache(); request execution does not use it automatically. */
  CACHE_KV?: KVNamespace
  SESSION_KV?: KVNamespace
  /** Optional source for Blueprint templates with type = "file". */
  TEMPLATES_KV?: KVNamespace
  /** Serves stored R2 objects at /uploads/* and exposes getStorage(). */
  FILES?: R2Bucket

  // Environment variables
  BLUEPRINT?: string // Serialized blueprint JSON
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  ZEBRIC_WEBHOOK_SECRET?: string
}

export interface WorkersAuthConfig {
  baseURL?: string
  secret?: string
  trustedOrigins?: string[]
}

export interface WorkersEngineConfig {
  env: WorkersEnv
  workflowServices?: WorkersWorkflowServices
  notificationFactories?: ReadonlyMap<string, AdapterFactory>
  /** Statically imported modules keyed by Blueprint plugin name. */
  plugins?: Readonly<Record<string, Plugin>>
  /** Statically imported command handlers keyed by Blueprint handler reference. */
  commandHandlers?: Readonly<Record<string, CommandHandler>>
  /** Optional plugin token lifecycle supplied by the application identity provider. */
  pluginAuth?: EngineAPI['auth']
  blueprint?: Blueprint // Pre-parsed blueprint
  blueprintContent?: string // Raw blueprint content (JSON/TOML)
  blueprintFormat?: 'json' | 'toml' // Format of blueprintContent
  theme?: Theme // Custom theme (defaults to defaultTheme)
  renderer?: HTMLRenderer // Custom renderer
  /** Imported file contents keyed by Blueprint template source path. */
  templates?: Readonly<Record<string, string>> | ReadonlyMap<string, string>
  /** Custom loader for file-backed page, slot, and auth templates. */
  templateLoader?: TemplateLoader
  /** Custom auth integration. Defaults to Better Auth on D1 when [auth] exists. */
  authProvider?: AuthProvider
  /** Override Better Auth environment configuration. */
  auth?: WorkersAuthConfig
  /** Override session resolution independently of the auth provider. */
  sessionManager?: SessionManagerPort
}

export class ZebricWorkersEngine {
  private blueprint!: Blueprint
  private db: D1Adapter
  private cache?: KVCache
  private storage?: R2Storage
  private adapter: BlueprintHttpAdapter
  private app: Hono
  private renderer: HTMLRenderer
  private authProvider?: AuthProvider
  private sessionManager?: SessionManagerPort
  private templateLoader?: TemplateLoader
  private templatesReady?: Promise<void>
  private queryExecutor: WorkersQueryExecutor
  private apiKeys: WorkersApiKeyRegistry
  private commandExecutor: CommandExecutor
  private workflowExecutor: D1WorkflowExecutor
  private readonly metrics = new MetricsRegistry()
  private readonly securityAudit: WorkersSecurityAudit
  private readonly notifications: NotificationManager
  private readonly plugins: BundledPluginRegistry
  private readonly services: ServiceRegistry
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  private idempotency = new WorkersIdempotencyCache()

  constructor(private config: WorkersEngineConfig) {
    this.db = new D1Adapter(config.env.DB)
    this.securityAudit = new WorkersSecurityAudit(this.db)

    if (config.env.CACHE_KV) {
      this.cache = new KVCache(config.env.CACHE_KV)
    }
    if (config.env.FILES) {
      this.storage = new R2Storage({ bucket: config.env.FILES })
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

    this.plugins = new BundledPluginRegistry(this.blueprint, config.plugins)
    this.services = new ServiceRegistry(this.blueprint.services, {
      resolveHandler: (service, operation) => {
        const name = service.plugin ?? service.name
        const integrations = this.plugins.get(name)?.plugin.integrations
        const implementation = integrations?.[service.name] ?? integrations?.[name] ?? integrations
        const handler = implementation?.[operation]
        return typeof handler === 'function' ? (params, context) => handler(params, context) : undefined
      },
    })
    this.apiKeys = new WorkersApiKeyRegistry(this.blueprint, config.env)
    this.notifications = createPortableNotificationManager(this.blueprint.notifications, config.env as unknown as Record<string, unknown>, new Map([['email', (adapter: Parameters<AdapterFactory>[0]) => new R2EmailOutbox(adapter, config.env.FILES)], ...(config.notificationFactories ?? [])]))

    this.authProvider = config.authProvider
    if (!this.authProvider && this.blueprint.auth) {
      const baseURL = config.auth?.baseURL
        ?? config.env.BETTER_AUTH_URL
        ?? this.blueprint.auth.trustedOrigins?.[0]
        ?? 'http://localhost:8787'
      const configuredSecret = config.auth?.secret ?? config.env.BETTER_AUTH_SECRET
      const { protocol, hostname } = new URL(baseURL)
      const isLocal = protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
      if (!configuredSecret && !isLocal) {
        throw new Error('BETTER_AUTH_SECRET is required unless the auth base URL is localhost')
      }
      this.authProvider = new WorkersBetterAuthProvider({
        database: config.env.DB,
        blueprint: this.blueprint,
        baseURL,
        secret: configuredSecret ?? 'development-secret-change-in-production',
        trustedOrigins: config.auth?.trustedOrigins,
      })
    }

    // Explicit session resolution wins. Better Auth is the default for an
    // authenticated Blueprint; SESSION_KV remains available for custom/public
    // applications and backwards compatibility.
    this.sessionManager = config.sessionManager
      ?? (this.authProvider ? new SessionManager(this.authProvider) : undefined)
    if (!this.sessionManager && config.env.SESSION_KV) {
      this.sessionManager = new WorkersSessionManager({
        kv: config.env.SESSION_KV
      })
    }

    this.templateLoader = config.templateLoader
      ?? (config.templates ? new BundledTemplateLoader({ templates: config.templates }) : undefined)
      ?? (config.env.TEMPLATES_KV ? new KVTemplateLoader({ kv: config.env.TEMPLATES_KV }) : undefined)

    // Initialize renderer if not provided.
    this.renderer = config.renderer || new HTMLRenderer(
      this.blueprint,
      config.theme || defaultTheme,
      undefined,
      this.templateLoader,
    )

    this.queryExecutor = instrumentQueries(new WorkersQueryExecutor(this.db, this.blueprint, { auditMutations: true }), this.metrics)
    this.commandExecutor = new CommandExecutor(this.blueprint, {
      queryExecutor: this.queryExecutor,
      services: config.workflowServices?.services ?? this.services,
      commandEffects: { enqueue: effects => this.queryExecutor.enqueueCommandEffects(effects) },
    })
    for (const [reference, handler] of Object.entries(config.commandHandlers ?? {})) this.commandExecutor.registerHandler(reference, handler)
    this.workflowExecutor = new D1WorkflowExecutor(this.blueprint, this.db, this.queryExecutor, { notificationService: this.notifications, pluginRegistry: this.plugins, services: this.services, ...config.workflowServices, commandExecutor: this.commandExecutor, auditLifecycle: true }, config.env.WORKFLOWS)
    const rendererPort = {
      renderPage: (context: any) => this.renderer.renderPage(context)
    }

    // Initialize adapter
    this.adapter = new BlueprintHttpAdapter({
      blueprint: this.blueprint,
      queryExecutor: this.queryExecutor,
      sessionManager: this.sessionManager,
      renderer: rendererPort,
      commandAvailability: {
        list: async ({ entity, record, session }) => {
          const commands = this.supportedCommands().filter(command => command.entity === entity)
          const available = await Promise.all(commands.map(async command =>
            [command.name, await this.commandExecutor.isAvailable(command.name, record, { session })] as const
          ))
          return available.filter(([, allowed]) => allowed).map(([name]) => name)
        },
      },
      auditLogger: this.securityAudit,
      errorSanitizer: new ErrorSanitizer(false),
    })

    this.app = new Hono()

    this.registerSecurityHeaders()
    if (this.authProvider || this.sessionManager) {
      this.registerCsrfProtection()
    }
    this.app.get('/health', async () => this.handleHealthCheck())
    this.app.get('/metrics', c => c.text(this.metrics.toPrometheus(), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }))
    this.registerUploadRoutes()
    this.registerNotificationRoutes()

    if (this.authProvider) {
      this.registerAuthRoutes()
    }

    registerWidgetRoutes(this.app, {
      blueprint: this.blueprint,
      queryExecutor: this.queryExecutor,
      sessionManager: this.sessionManager,
    })
    registerSearchRoutes(this.app, {
      blueprint: this.blueprint,
      queryExecutor: this.queryExecutor,
      sessionManager: this.sessionManager,
    })

    registerWorkersDiscoveryRoutes(this.app, this.blueprint, { durableWorkflows: Boolean(this.config.env.WORKFLOWS), commandHandlers: Object.keys(config.commandHandlers ?? {}) })
    this.registerCommandRoutes()
    registerJournalRoutes(this.app, {
      blueprint: this.blueprint, journal: new D1RuntimeJournal(this.db), queries: this.queryExecutor,
      resolveSession: request => this.resolveApiSession(request),
    })
    this.registerWorkflowRoutes()
    this.registerEntityApiRoutes()

    this.app.all('*', async (c) => {
      return this.adapter.handle(c.req.raw)
    })
  }

  /**
   * Handle incoming request
   */
  async fetch(request: Request, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
    try {
      await this.ensureReady()
      if (!this.templatesReady && this.templateLoader instanceof KVTemplateLoader) {
        this.templatesReady = this.templateLoader.preload(this.collectFileTemplates()).catch(error => {
          // Do not cache a failed preload; the next request retries.
          this.templatesReady = undefined
          throw error
        })
      }
      await this.templatesReady
      const response = await this.securityAudit.run(async () => this.app.fetch(request, this.config.env))
      const recovery = this.deliverWorkflowEvents()
      if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(recovery)
      else await recovery
      return response
    } catch (error) {
      console.error('Request handling error:', error)
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
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

  getStorage(): R2Storage | undefined {
    return this.storage
  }

  getAuthProvider(): AuthProvider | undefined {
    return this.authProvider
  }

  getSessionManager(): SessionManagerPort | undefined {
    return this.sessionManager
  }

  /** Await this before programmatic workflow execution; fetch, cron, and native jobs do so automatically. */
  async ensureReady(): Promise<void> {
    await this.plugins.initialize(this.getEngineAPI(), {
      db: true, auth: Boolean(this.sessionManager), storage: Boolean(this.storage), cache: Boolean(this.cache),
    })
  }

  getPlugins(): BundledPluginRegistry { return this.plugins }

  getEngineAPI(): EngineAPI {
    const requireCache = () => { if (!this.cache) throw new Error('Plugin cache requires CACHE_KV'); return this.cache }
    const requireStorage = () => { if (!this.storage) throw new Error('Plugin storage requires FILES'); return this.storage }
    return {
      db: this.queryExecutor,
      blueprint: this.blueprint,
      auth: this.config.pluginAuth ?? {
        getCurrentUser: async request => (await this.sessionManager?.getSession(request))?.user ?? null,
        createSession: async () => { throw new Error('Plugin token creation requires config.pluginAuth') },
        invalidateSession: async () => { throw new Error('Plugin token invalidation requires config.pluginAuth') },
      },
      storage: {
        upload: (key, data, options) => requireStorage().store(key, data, options?.contentType),
        download: async key => {
          const body = await requireStorage().retrieve(key)
          if (!body) throw new Error(`File not found: ${key}`)
          return new Response(body).arrayBuffer()
        },
        delete: key => requireStorage().delete(key),
        getUrl: key => `/uploads/${key.split('/').map(encodeURIComponent).join('/')}`,
      },
      cache: {
        get: key => requireCache().get(key), set: (key, value, ttl) => requireCache().set(key, value, ttl),
        delete: key => requireCache().delete(key), incr: key => requireCache().incr(key),
        exists: key => requireCache().exists(key), clear: () => requireCache().clear(),
      },
      workflows: { trigger: async (name, context) => { await this.workflowExecutor.triggerManual(name, context, context?.session) } },
      on: (event, listener) => { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]) },
      emit: (event, data) => { for (const listener of this.listeners.get(event) ?? []) listener(data) },
      log: { debug: console.debug, info: console.info, warn: console.warn, error: console.error },
    }
  }

  getMetrics() { return this.metrics.getSnapshot() }

  getNotificationManager(): NotificationManager { return this.notifications }

  private registerUploadRoutes(): void {
    if (!this.config.env.FILES) return
    this.app.get('/uploads/*', async c => {
      let key: string
      try { key = decodeURIComponent(new URL(c.req.url).pathname.slice('/uploads/'.length)) }
      catch { return c.json({ error: 'File not found' }, 404) }
      if (!key || key === '_zebric' || key.startsWith('_zebric/') || key.split('/').some(part => part === '.' || part === '..') || key.includes('\\')) {
        return c.json({ error: 'File not found' }, 404)
      }
      const object = await this.config.env.FILES!.get(key)
      if (!object) return c.json({ error: 'File not found' }, 404)
      return new Response(object.body, { headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Content-Length': String(object.size),
      } })
    })
  }

  private registerNotificationRoutes(): void {
    this.app.all('/notifications/:adapterName/inbound', async c => {
      const request = c.req.raw.clone()
      const response = await this.notifications.handleRequest(c.req.param('adapterName'), c.req.raw)
      if (!response.ok) return response
      const contentType = request.headers.get('content-type') ?? ''
      let body: unknown
      try {
        body = contentType.includes('application/json') ? await request.json()
          : contentType.includes('application/x-www-form-urlencoded') ? Object.fromEntries(await request.formData())
          : await request.text()
      } catch { body = undefined }
      if ((body as { type?: string } | undefined)?.type !== 'url_verification') {
        const path = new URL(request.url).pathname
        await this.workflowExecutor.triggerWebhook(path, {
          headers: Object.fromEntries(request.headers), body,
          query: Object.fromEntries(new URL(request.url).searchParams),
        }, workflow => workflow.trigger.webhook === path)
      }
      return response
    })
  }

  private registerSecurityHeaders(): void {
    this.app.use('*', async (c, next) => {
      const start = this.metrics.now()
      const requestId = c.req.header('x-request-id') || crypto.randomUUID()
      try { await next() }
      finally { this.metrics.recordRequest(c.req.routePath, c.res.status, this.metrics.now() - start) }
      if (c.res.status === 401 || c.res.status === 403) {
        this.securityAudit.log({ eventType: 'access.denied', severity: 'warning', action: c.req.method,
          resource: new URL(c.req.url).pathname, success: false, requestId })
      }
      c.header('X-Request-ID', requestId)
      c.header('X-Trace-ID', requestId)
      c.header('X-XSS-Protection', '1; mode=block')
      c.header('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
      ].join('; '))
      c.header('X-Content-Type-Options', 'nosniff')
      c.header('X-Frame-Options', 'DENY')
      c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      return c.res
    })
  }

  private registerAuthRoutes(): void {
    this.app.all('/api/auth/*', async (c) => {
      try {
        const instance = this.authProvider!.getAuthInstance()
        if (!instance?.handler) {
          return Response.json({ error: 'Authentication handler is not configured' }, { status: 501 })
        }
        const response = await instance.handler(c.req.raw)
        const path = new URL(c.req.url).pathname
        this.securityAudit.log({ eventType: response.ok ? 'auth.success' : 'auth.failure',
          severity: response.ok ? 'info' : 'warning', action: c.req.method, resource: path,
          success: response.ok, requestId: c.req.header('x-request-id') })
        return response
      } catch (error) {
        console.error('Auth route error:', error)
        return Response.json({ error: 'Authentication failed' }, { status: 500 })
      }
    })

    this.app.get('/auth/sign-in', (c) => {
      return c.html(this.renderer.renderSignInPage(
        this.authCallback(c.req.raw),
        undefined,
        getInjectedCsrfTokenFromRequest(c.req.raw),
      ))
    })
    this.app.get('/auth/sign-up', (c) => {
      return c.html(this.renderer.renderSignUpPage(
        this.authCallback(c.req.raw),
        undefined,
        getInjectedCsrfTokenFromRequest(c.req.raw),
      ))
    })
    this.app.get('/auth/sign-out', (c) => {
      return c.html(this.renderer.renderSignOutPage(
        this.authCallback(c.req.raw),
        getInjectedCsrfTokenFromRequest(c.req.raw),
      ))
    })
  }

  private registerCsrfProtection(): void {
    this.app.use('*', async (c, next) => {
      const request = c.req.raw
      const method = request.method.toUpperCase()
      if (['/webhooks/', '/notifications/'].some(prefix => new URL(request.url).pathname.startsWith(prefix))) { await next(); return c.res }
      const safe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
      const cookieToken = WorkersCookieManager.get(request, 'csrf-token')?.trim()

      // A valid scoped API key is not a browser cookie credential and is not
      // vulnerable to CSRF. Invalid bearer values must not bypass validation.
      if (await this.apiKeys.resolveRequest(request)) {
        await next()
        return c.res
      }

      if (safe) {
        const token = cookieToken || crypto.randomUUID()
        injectCsrfTokenIntoRequest(request, token)
        await next()
        if (!cookieToken) {
          c.header('Set-Cookie', WorkersCookieManager.serialize('csrf-token', token, {
            httpOnly: false,
            secure: new URL(request.url).protocol === 'https:',
            sameSite: 'strict',
            path: '/',
          }), { append: true })
        }
        return c.res
      }

      // Without an auth provider (legacy SESSION_KV), only requests that carry a
      // live session have an ambient credential worth protecting.
      if (!this.authProvider && !(await this.sessionManager?.getSession(request))) {
        await next()
        return c.res
      }

      const submitted = await this.extractCsrfToken(request)
      if (!cookieToken || !submitted || cookieToken !== submitted.trim()) {
        this.securityAudit.log({ eventType: 'csrf.violation', severity: 'warning', action: request.method, resource: new URL(request.url).pathname, success: false })
        return Response.json({ error: 'Invalid CSRF token' }, { status: 403 })
      }
      injectCsrfTokenIntoRequest(request, cookieToken)
      await next()
      return c.res
    })
  }

  private async extractCsrfToken(request: Request): Promise<string | undefined> {
    const header = request.headers.get('x-csrf-token')
    if (header) return header
    const urlToken = new URL(request.url).searchParams.get('_csrf')
    if (urlToken) return urlToken

    const contentType = request.headers.get('content-type') ?? ''
    try {
      if (contentType.includes('application/json')) {
        const body = await request.clone().json() as Record<string, unknown>
        return typeof body?._csrf === 'string' ? body._csrf : undefined
      }
      if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const value = (await request.clone().formData()).get('_csrf')
        return typeof value === 'string' ? value : undefined
      }
    } catch {
      return undefined
    }
    return undefined
  }

  private supportedCommands(): Command[] {
    return (this.blueprint.commands ?? []).filter(command => !command.handler || Boolean(this.config.commandHandlers?.[command.handler]))
  }

  private registerCommandRoutes(): void {
    const commands = new Map(this.supportedCommands().map(command => [commandOperationId(command.name), command]))

    this.app.post('/api/commands/:operationId/:id', async c => {
      const command = commands.get(c.req.param('operationId'))
      if (!command) return this.agentError(404, 'NOT_FOUND', 'Command not found')
      try {
        const session = await this.resolveApiSession(c.req.raw)
        if (!session) return this.agentError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
        if (!agentHasScopes(session, command.scopes ?? [])) {
          return this.agentError(403, 'INSUFFICIENT_SCOPE', 'The credential lacks required command scopes')
        }
        this.requireAgentRunId(c.req.raw, session)
        const input = await this.parseOptionalJsonObject(c.req.raw)
        const execute = async () => {
          const recordId = this.requireEntityId(c.req.param('id'))
          const before = await this.queryExecutor.findById(command.entity, recordId, { session }).catch(() => undefined)
          const result = await this.commandExecutor.execute({
            command: command.name,
            recordId,
            input,
            context: {
              session,
              source: session.actor?.type === 'agent' ? 'mcp' : 'http',
              correlationId: c.req.header('x-correlation-id') ?? c.req.header('x-request-id'),
            },
          })
          await this.workflowExecutor.enqueueEntityEvent({ entity: command.entity, event: 'update', before, after: result.record, session })
          return Response.json(result)
        }
        return await this.withIdempotency(c.req.raw, session, `${command.name}:${c.req.param('id')}`, input, execute, true)
      } catch (error) {
        return this.commandError(error)
      }
    })

    this.app.post('/commands/:operationId/:id', async c => {
      const command = commands.get(c.req.param('operationId'))
      if (!command) return c.notFound()
      const session = await this.sessionManager?.getSession(c.req.raw) ?? null
      if (!session) {
        const callback = this.safeRedirect(undefined, c.req.header('referer'), c.req.url)
        return c.redirect(`/auth/sign-in?callback=${encodeURIComponent(callback)}`, 303)
      }
      let form: Record<string, unknown> = {}
      try {
        form = Object.fromEntries(await c.req.raw.formData())
        const input = this.coerceCommandInput(command, form)
        await this.queryExecutor.transaction(async () => {
          const recordId = this.requireEntityId(c.req.param('id'))
          const before = await this.queryExecutor.findById(command.entity, recordId, { session }).catch(() => undefined)
          const result = await this.commandExecutor.execute({
            command: command.name,
            recordId,
            input,
            context: { session, source: 'ui' },
          })
          await this.workflowExecutor.enqueueEntityEvent({ entity: command.entity, event: 'update', before, after: result.record, session })
        })
        return c.redirect(this.safeRedirect(form.redirect, c.req.header('referer'), c.req.url), 303)
      } catch (error) {
        console.error(`Command ${command.name} failed:`, error)
        const message = error instanceof DomainError || error instanceof ValidationFailureError
          ? error.message
          : 'Command execution failed'
        if (c.req.header('accept')?.includes('application/json')) {
          return Response.json({ error: message }, { status: 400 })
        }
        // Browser form post: go back to the originating page with the error.
        const target = new URL(this.safeRedirect(form.redirect, c.req.header('referer'), c.req.url), c.req.url)
        target.searchParams.set('error', message)
        return c.redirect(`${target.pathname}${target.search}`, 303)
      }
    })
  }

  private registerWorkflowRoutes(): void {
    for (const skill of this.blueprint.skills ?? []) {
      for (const action of skill.actions.filter(action => action.workflow && this.workflowExecutor.has(action.workflow))) {
        const route = action.path.replace(/\{(\w+)\}/g, ':$1')
        const method = action.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'
        this.app[method](route, async c => {
          try {
            const session = await this.resolveApiSession(c.req.raw)
            if (skill.auth !== 'none' && !session) {
              return this.agentError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
            }
            if (!agentHasScopes(session, action.scopes ?? [])) {
              return this.agentError(403, 'INSUFFICIENT_SCOPE', 'The credential lacks required scopes')
            }
            if (method !== 'get') this.requireAgentRunId(c.req.raw, session)
            const rawBody = method === 'get' ? {} : await this.parseOptionalJsonObject(c.req.raw)
            const body = action.body
              ? Object.fromEntries(Object.entries(rawBody).filter(([key]) => Object.hasOwn(action.body!, key)))
              : rawBody
            const params = Object.fromEntries(
              [...action.path.matchAll(/\{(\w+)\}/g)].map(match => [match[1]!, c.req.param(match[1]!)]),
            )
            const record = action.entity && params.id
              ? await this.queryExecutor.findById(action.entity, params.id, { session }).catch(() => null)
              : null
            const data = {
              params,
              body,
              payload: body,
              entity: action.entity,
              recordId: params.id,
              record,
              user: session?.user,
              session,
              attribution: session?.actor?.type === 'agent' ? {
                agentId: session.actor.id,
                credentialId: session.actor.credentialId,
                runId: c.req.header('x-agent-run-id'),
              } : undefined,
            }
            const execute = async () => {
              const key = c.req.header('idempotency-key')?.trim()
              const url = new URL(c.req.url)
              const submission = key ? {
                scope: `${securityId(session) ?? 'anonymous'}:${key}`,
                fingerprint: await requestFingerprint(`${skill.name}:${action.name}`, c.req.method, `${url.pathname}${url.search}`, JSON.stringify(body)),
              } : undefined
              const job = await this.workflowExecutor.triggerManual(action.workflow!, data, session ?? undefined, submission)
              return Response.json({
                success: true,
                job: { id: job.id, workflow: job.workflowName, status: this.publicJobStatus(job.status), url: `/api/jobs/${job.id}` },
              }, { status: 202, headers: { Location: `/api/jobs/${job.id}` } })
            }
            return await this.withIdempotency(c.req.raw, session, `${skill.name}:${action.name}`, body, execute)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('Idempotency key was reused')) return this.agentError(409, 'IDEMPOTENCY_KEY_REUSE', 'The idempotency key was reused with different input')
            if (message.includes('precondition failed')) {
              return this.agentError(409, 'WORKFLOW_PRECONDITION_FAILED', 'The workflow precondition was not satisfied')
            }
            if (message.startsWith('Invalid agent attribution:')) {
              return this.agentError(400, 'INVALID_AGENT_ATTRIBUTION', 'Valid agent run attribution is required')
            }
            console.error(`Workflow action ${skill.name}.${action.name} failed:`, error)
            return this.agentError(500, 'INTERNAL_ERROR', 'The Agent API action failed', true)
          }
        })
      }
    }

    this.app.all('/webhooks/*', async c => {
      const workflows = this.workflowExecutor.list().filter(workflow => workflow.enabled !== false && workflow.trigger.webhook === new URL(c.req.url).pathname)
      if (!workflows.length) return Response.json({ error: 'No workflow found for this webhook' }, { status: 404 })
      const rawBody = await c.req.raw.clone().text()
      const authorized = new Set<string>()
      let configured = false
      for (const workflow of workflows) {
        const secret = (this.config.env as unknown as Record<string, unknown>)[workflow.trigger.webhookSecretEnv ?? 'ZEBRIC_WEBHOOK_SECRET']
        if (typeof secret !== 'string' || !secret) continue
        configured = true
        if (await verifyWebhookRequest(c.req.raw, rawBody, secret)) authorized.add(workflow.name)
      }
      if (!configured) return Response.json({ error: 'Webhook is not configured securely' }, { status: 503 })
      if (!authorized.size) return Response.json({ error: 'Invalid webhook credentials' }, { status: 401 })
      let body: unknown = rawBody
      if (c.req.header('content-type')?.includes('application/json')) {
        try { body = JSON.parse(rawBody) } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
      }
      const jobs = await this.workflowExecutor.triggerWebhook(new URL(c.req.url).pathname, {
        headers: Object.fromEntries(c.req.raw.headers), body, query: Object.fromEntries(new URL(c.req.url).searchParams),
      }, workflow => authorized.has(workflow.name))
      return Response.json({ success: true, jobs: jobs.map(job => ({ id: job.id, workflow: job.workflowName, status: this.publicJobStatus(job.status) })) })
    })

    this.app.get('/api/jobs/:id', async c => {
      const session = await this.resolveApiSession(c.req.raw)
      if (!session) return this.agentError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
      const job = await this.workflowExecutor.getJob(c.req.param('id'), securityId(session))
      if (!job || !job.ownerId || job.ownerId !== securityId(session)) {
        return this.agentError(404, 'JOB_NOT_FOUND', 'The workflow job was not found')
      }
      return Response.json({
        id: job.id,
        workflow: job.workflowName,
        status: this.publicJobStatus(job.status),
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: job.result,
        error: job.error ?? null,
      })
    })

    for (const operation of ['cancel', 'retry'] as const) {
      this.app.post(`/api/jobs/:id/${operation}`, async c => {
        const session = await this.resolveApiSession(c.req.raw)
        if (!session) return this.agentError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
        const id = c.req.param('id')
        const job = await this.workflowExecutor.getJob(id, securityId(session))
        if (!job?.ownerId || job.ownerId !== securityId(session)) return this.agentError(404, 'JOB_NOT_FOUND', 'The workflow job was not found')
        // Agent mutations retain the attribution requirement of other API routes.
        try { this.requireAgentRunId(c.req.raw, session) } catch { return this.agentError(400, 'INVALID_AGENT_ATTRIBUTION', 'Valid agent run attribution is required') }
        const changed = operation === 'cancel' ? await this.workflowExecutor.cancelJob(id) : await this.workflowExecutor.retryJob(id)
        if (!changed) return this.agentError(409, 'JOB_STATE_CONFLICT', `The workflow job cannot ${operation} in its current state`)
        return Response.json({ success: true, id })
      })
    }

    this.app.post('/actions/:workflowName', async c => {
      const session = await this.sessionManager?.getSession(c.req.raw) ?? null
      if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
      const workflowName = c.req.param('workflowName')
      if (!this.workflowExecutor.has(workflowName)) return Response.json({ error: 'Workflow not found' }, { status: 404 })
      try {
        const contentType = c.req.header('content-type') ?? ''
        const body = contentType.includes('application/json')
          ? await this.parseOptionalJsonObject(c.req.raw)
          : Object.fromEntries(await c.req.raw.formData())
        const payload = typeof body.payload === 'string'
          ? JSON.parse(body.payload || '{}')
          : body.payload ?? {}
        const entity = typeof body.entity === 'string' ? body.entity : undefined
        const recordId = typeof body.recordId === 'string' ? body.recordId : undefined
        const record = entity && recordId
          ? await this.queryExecutor.findById(entity, recordId, { session }).catch(() => null)
          : null
        const data = {
          payload,
          entity,
          recordId,
          record,
          page: body.page,
          redirect: body.redirect,
          session,
        }
        const job = await this.workflowExecutor.triggerManual(workflowName, data, session)
        if (c.req.header('accept')?.includes('application/json')) {
          return Response.json({ success: true, job: { id: job.id, workflow: workflowName } })
        }
        return c.redirect(this.safeRedirect(body.redirect, c.req.header('referer'), c.req.url), 303)
      } catch (error) {
        const status = error instanceof Error && error.message.includes('precondition failed') ? 409 : 500
        return Response.json({ error: status === 409 ? 'Workflow precondition failed' : 'Failed to trigger action' }, { status })
      }
    })
  }

  private registerEntityApiRoutes(): void {
    const reserved = new Set(['/api/jobs', '/api/commands', '/api/auth', '/api/openapi.json'])
    for (const entity of this.blueprint.entities) {
      const collectionPath = `/api/${entity.name.toLowerCase()}s`
      if (reserved.has(collectionPath)) {
        throw new Error(`Entity ${entity.name} maps to ${collectionPath}, which is reserved by the Workers runtime; rename the entity`)
      }
      const itemPath = `${collectionPath}/:id`

      this.app.get(collectionPath, async c => this.handleEntityApi(c, entity.name, 'list', async session => {
        const parsedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
        const parsedOffset = Number.parseInt(c.req.query('offset') ?? '', 10)
        const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100, 1000)
        const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : undefined
        const orderBy = entity.fields.some(field => field.name === 'createdAt')
          ? { createdAt: 'desc' as const }
          : undefined
        return Response.json(await this.queryExecutor.execute({
          entity: entity.name,
          orderBy,
          limit,
          offset,
        }, { session }))
      }))

      this.app.get(itemPath, async c => this.handleEntityApi(c, entity.name, 'get', async session => {
        const result = await this.queryExecutor.findById(entity.name, this.requireEntityId(c.req.param('id')), { session })
        return result
          ? Response.json(result)
          : Response.json({ error: 'Not found' }, { status: 404 })
      }))

      this.app.post(collectionPath, async c => this.handleEntityApi(c, entity.name, 'create', async session => {
        this.requireAgentRunId(c.req.raw, session)
        const data = await this.parseJsonObject(c.req.raw)
        const result = await this.queryExecutor.create(entity.name, data, { session })
        await this.workflowExecutor.triggerEntity(entity.name, 'create', undefined, result, session)
        return Response.json(result, { status: 201 })
      }))

      this.app.put(itemPath, async c => this.handleEntityApi(c, entity.name, 'update', async session => {
        this.requireAgentRunId(c.req.raw, session)
        const data = await this.parseJsonObject(c.req.raw)
        const id = this.requireEntityId(c.req.param('id'))
        const before = await this.queryExecutor.findById(entity.name, id, { session }).catch(() => undefined)
        const result = await this.queryExecutor.update(entity.name, id, data, { session })
        await this.workflowExecutor.triggerEntity(entity.name, 'update', before, result, session)
        return Response.json(result)
      }))

      this.app.delete(itemPath, async c => this.handleEntityApi(c, entity.name, 'delete', async session => {
        this.requireAgentRunId(c.req.raw, session)
        const id = this.requireEntityId(c.req.param('id'))
        const before = await this.queryExecutor.findById(entity.name, id, { session }).catch(() => ({ id }))
        await this.queryExecutor.delete(entity.name, id, { session })
        await this.workflowExecutor.triggerEntity(entity.name, 'delete', before, undefined, session)
        return Response.json({ success: true })
      }))
    }
  }

  private async handleEntityApi(
    c: any,
    entity: string,
    action: 'list' | 'get' | 'create' | 'update' | 'delete',
    execute: (session: UserSession | null) => Promise<Response>,
  ): Promise<Response> {
    try {
      const session = await this.resolveApiSession(c.req.raw)
      if (!agentHasScopes(session, [`entity.${entity.toLowerCase()}.${action}`])) {
        throw new Error('Access denied: insufficient agent scope')
      }
      const response = await execute(session)
      if ((action === 'list' || action === 'get') && response.ok) {
        this.securityAudit.log({ eventType: 'data.read', severity: 'info', action,
          resource: new URL(c.req.url).pathname, entityType: entity, entityId: c.req.param('id'),
          userId: session?.user?.id, actorId: session?.actor?.id ?? session?.user?.id,
          actorType: session?.actor?.type ?? (session ? 'user' : undefined), success: true,
          requestId: c.req.header('x-request-id') })
      }
      return response
    } catch (error) {
      const label = action === 'get' ? 'Find' : `${action[0]!.toUpperCase()}${action.slice(1)}`
      console.error(`${label} ${entity} error:`, error)
      const status = this.entityApiErrorStatus(error)
      return Response.json({
        error: `${label} failed`,
        ...(status < 500 ? { details: error instanceof Error ? error.message : 'Unknown error' } : {}),
      }, { status })
    }
  }

  private async resolveApiSession(request: Request): Promise<UserSession | null> {
    return await this.apiKeys.resolveRequest(request)
      ?? await this.sessionManager?.getSession(request)
      ?? null
  }

  private requireAgentRunId(request: Request, session: UserSession | null): void {
    if (session?.actor?.type !== 'agent') return
    const runId = request.headers.get('x-agent-run-id')?.trim()
    if (!runId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) {
      throw new Error('Invalid agent attribution: X-Agent-Run-ID must be 1-128 safe characters')
    }
  }

  private async parseJsonObject(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Invalid request: application/json is required')
    }
    const data = await request.json().catch(() => null)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid request: JSON object body is required')
    }
    return data as Record<string, unknown>
  }

  private async parseOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
    const text = await request.clone().text()
    if (!text.trim()) return {}
    if (!request.headers.get('content-type')?.includes('application/json')) {
      throw new ValidationFailureError('Command input must be a JSON object')
    }
    const data = JSON.parse(text) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ValidationFailureError('Command input must be a JSON object')
    }
    return data as Record<string, unknown>
  }

  private async withIdempotency(
    request: Request,
    session: UserSession | null,
    operation: string,
    input: Record<string, unknown>,
    execute: () => Promise<Response>,
    durableCommand = false,
  ): Promise<Response> {
    const key = request.headers.get('idempotency-key')?.trim()
    if (!key) return durableCommand ? this.queryExecutor.transaction(execute) : execute()
    const url = new URL(request.url)
    const fingerprint = await requestFingerprint(operation, request.method, `${url.pathname}${url.search}`, JSON.stringify(input))
    if (durableCommand) {
      const response = await this.queryExecutor.transaction(async () => {
        const response = await execute()
        return { status: response.status, headers: [...response.headers.entries()], body: await response.text() }
      }, { key: JSON.stringify(['command', securityId(session) ?? 'anonymous', key]), fingerprint })
      return new Response(response.body, { status: response.status, headers: response.headers })
    }
    const result = await this.idempotency.run(`${securityId(session) ?? 'anonymous'}:${key}`, fingerprint, execute)
    return result.conflict
      ? this.agentError(409, 'IDEMPOTENCY_KEY_REUSE', 'The idempotency key was reused with different input')
      : result.response
  }

  private coerceCommandInput(command: Command, body: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(command.input ?? {})) {
      const raw = body[name]
      if (raw === undefined || raw === null || raw === '') continue
      if (typeof raw !== 'string') throw new ValidationFailureError(`Invalid value for ${name}`)
      if (field.type === 'Integer') {
        const value = Number(raw)
        if (!Number.isInteger(value)) throw new ValidationFailureError(`Invalid integer for ${name}`)
        result[name] = value
      } else if (field.type === 'Float') {
        const value = Number(raw)
        if (!Number.isFinite(value)) throw new ValidationFailureError(`Invalid number for ${name}`)
        result[name] = value
      } else if (field.type === 'Boolean') {
        if (raw !== 'true' && raw !== 'false') throw new ValidationFailureError(`Invalid boolean for ${name}`)
        result[name] = raw === 'true'
      } else if (field.type === 'JSON') {
        try {
          result[name] = JSON.parse(raw)
        } catch {
          throw new ValidationFailureError(`Invalid JSON for ${name}`)
        }
      } else {
        result[name] = raw
      }
    }
    return result
  }

  private commandError(error: unknown): Response {
    if (error instanceof D1IdempotencyConflict) return this.agentError(409, 'IDEMPOTENCY_KEY_REUSE', error.message)
    if (error instanceof D1TransactionConflict) return this.agentError(409, 'TRANSACTION_CONFLICT', error.message, true)
    if (error instanceof DomainError) {
      const status = error.code === 'AUTHORIZATION_FAILED' ? 403
        : error.code === 'COMMAND_UNAVAILABLE' ? 409
          : error.code === 'VALIDATION_FAILED' ? 422
            : 400
      return this.agentError(status, error.code, error.message)
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Invalid agent attribution:')) {
      return this.agentError(400, 'INVALID_AGENT_ATTRIBUTION', 'Valid agent run attribution is required')
    }
    console.error('Command execution failed:', error)
    return this.agentError(500, 'INTERNAL_ERROR', 'Command execution failed', true)
  }

  private agentError(status: number, code: string, message: string, retryable = false): Response {
    return Response.json({ error: { code, message, retryable } }, { status })
  }

  private publicJobStatus(status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'): 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' {
    return status === 'completed' ? 'succeeded' : status
  }

  private safeRedirect(value: unknown, referer: string | undefined, requestUrl: string): string {
    const origin = new URL(requestUrl).origin
    const candidate = typeof value === 'string' ? value : referer ?? '/'
    const parsed = new URL(candidate, origin)
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}` : '/'
  }

  private requireEntityId(id: string | undefined): string {
    if (!id) throw new Error('Invalid request: entity ID is required')
    return id
  }

  private entityApiErrorStatus(error: unknown): 400 | 403 | 404 | 500 {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Invalid request:') || message.startsWith('Invalid agent attribution:')) return 400
    if (message.includes('Access denied')) return 403
    if (message.toLowerCase().includes('not found')) return 404
    return 500
  }

  getWorkflowExecutor(): D1WorkflowExecutor {
    return this.workflowExecutor
  }

  async scheduled(cron: string): Promise<void> {
    await this.ensureReady()
    await this.deliverWorkflowEvents()
    await this.workflowExecutor.triggerSchedule(cron)
  }

  async deliverWorkflowEvents(limit = 25): Promise<{ delivered: number; failed: number }> {
    try { return await this.workflowExecutor.deliverPendingEvents(limit) }
    catch (error) {
      console.error('Workflow outbox recovery failed:', error)
      return { delivered: 0, failed: 1 }
    }
  }

  private authCallback(request: Request): string {
    const url = new URL(request.url)
    const raw = url.searchParams.get('callback') ?? url.searchParams.get('redirect') ?? '/'
    const parsed = new URL(raw, url.origin)
    return `${url.origin}${parsed.pathname}${parsed.search}`
  }

  private collectFileTemplates(): Array<{ source: string; engine?: 'handlebars' | 'liquid' }> {
    const templates = new Map<string, { source: string; engine?: 'handlebars' | 'liquid' }>()
    const add = (template: { source: string; engine?: 'handlebars' | 'liquid'; type?: 'file' | 'inline' } | undefined, defaultType: 'file' | 'inline') => {
      if (!template || (template.type ?? defaultType) !== 'file') return
      templates.set(`${template.source}:${template.engine ?? 'liquid'}`, {
        source: template.source,
        engine: template.engine,
      })
    }

    for (const page of this.blueprint.pages) {
      add(page.template, 'file')
      for (const slot of Object.values(page.layoutSlots ?? {})) add(slot, 'inline')
    }
    const authPages = this.blueprint.auth?.pages
    if (authPages) {
      add(authPages.signIn, 'file')
      add(authPages.signUp, 'file')
      add(authPages.signOut, 'file')
      add(authPages.loginRequired, 'file')
    }
    return [...templates.values()]
  }
}

/**
 * Create a Workers fetch handler
 */
export type WorkersHandlerConfig = Omit<WorkersEngineConfig, 'env'> | ((env: WorkersEnv) => Omit<WorkersEngineConfig, 'env'>)

export function createWorkerHandler(config: WorkersHandlerConfig) {
  let engine: ZebricWorkersEngine | undefined
  const getEngine = (env: WorkersEnv) => engine ??= new ZebricWorkersEngine({ ...(typeof config === 'function' ? config(env) : config), env })
  return {
    async scheduled(controller: ScheduledController, env: WorkersEnv, ctx: ExecutionContext): Promise<void> {
      ctx.waitUntil(getEngine(env).scheduled(controller.cron))
    },
    async fetch(request: Request, env: WorkersEnv, ctx: ExecutionContext): Promise<Response> {
      return getEngine(env).fetch(request, ctx)
    }
  }
}
