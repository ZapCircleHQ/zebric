/**
 * Zebric Workers Engine
 *
 * CloudFlare Workers adapter for Zebric runtime.
 */

import { BlueprintParser, detectFormat, ErrorSanitizer, HTMLRenderer, SessionManager, defaultTheme, analyzeTransactionalWorkflow, getInjectedCsrfTokenFromRequest, injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { AuthProvider, Blueprint, SessionManagerPort, TemplateLoader, Theme, UserSession } from '@zebric/runtime-core'
import { Hono } from 'hono'
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

export interface WorkersEnv {
  // CloudFlare bindings
  DB: D1Database
  /** Creates the cache returned by getCache(); request execution does not use it automatically. */
  CACHE_KV?: KVNamespace
  SESSION_KV?: KVNamespace
  /** Optional source for Blueprint templates with type = "file". */
  TEMPLATES_KV?: KVNamespace
  /** Creates the storage returned by getStorage(); upload routes are not automatic. */
  FILES?: R2Bucket

  // Environment variables
  BLUEPRINT?: string // Serialized blueprint JSON
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
}

export interface WorkersAuthConfig {
  baseURL?: string
  secret?: string
  trustedOrigins?: string[]
}

export interface WorkersEngineConfig {
  env: WorkersEnv
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

  constructor(private config: WorkersEngineConfig) {
    this.db = new D1Adapter(config.env.DB)

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

    this.apiKeys = new WorkersApiKeyRegistry(this.blueprint, config.env)

    const unsupportedWorkflows = this.blueprint.workflows ?? []
    if (unsupportedWorkflows.length > 0) {
      const details = unsupportedWorkflows.map(workflow => {
        if (!workflow.transactional) {
          return `${workflow.name} (workflow execution is not implemented)`
        }

        const analysis = analyzeTransactionalWorkflow(workflow)
        return `${workflow.name} (${analysis.d1BatchEligible ? 'D1-batch eligible but not yet executable' : analysis.reasons.join('; ')})`
      })
      throw new Error(
        `Cloudflare Workers workflows are not yet supported: ${details.join(', ')}`
      )
    }

    this.authProvider = config.authProvider
    if (!this.authProvider && this.blueprint.auth) {
      const baseURL = config.auth?.baseURL
        ?? config.env.BETTER_AUTH_URL
        ?? this.blueprint.auth.trustedOrigins?.[0]
        ?? 'http://localhost:8787'
      const configuredSecret = config.auth?.secret ?? config.env.BETTER_AUTH_SECRET
      if (!configuredSecret && new URL(baseURL).protocol === 'https:') {
        throw new Error('BETTER_AUTH_SECRET is required for HTTPS Cloudflare Workers deployments')
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

    this.queryExecutor = new WorkersQueryExecutor(this.db, this.blueprint)
    const rendererPort = {
      renderPage: (context: any) => this.renderer.renderPage(context)
    }

    // Initialize adapter
    this.adapter = new BlueprintHttpAdapter({
      blueprint: this.blueprint,
      queryExecutor: this.queryExecutor,
      sessionManager: this.sessionManager,
      renderer: rendererPort,
      errorSanitizer: new ErrorSanitizer(false),
    })

    this.app = new Hono()

    this.registerSecurityHeaders()
    if (this.authProvider) {
      this.registerCsrfProtection()
    }
    this.app.get('/health', async () => this.handleHealthCheck())

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

    registerWorkersDiscoveryRoutes(this.app, this.blueprint)
    this.registerEntityApiRoutes()

    this.app.all('*', async (c) => {
      return this.adapter.handle(c.req.raw)
    })
  }

  /**
   * Handle incoming request
   */
  async fetch(request: Request): Promise<Response> {
    try {
      if (!this.templatesReady && this.templateLoader instanceof KVTemplateLoader) {
        this.templatesReady = this.templateLoader.preload(this.collectFileTemplates())
      }
      await this.templatesReady
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

  getStorage(): R2Storage | undefined {
    return this.storage
  }

  getAuthProvider(): AuthProvider | undefined {
    return this.authProvider
  }

  getSessionManager(): SessionManagerPort | undefined {
    return this.sessionManager
  }

  private registerSecurityHeaders(): void {
    this.app.use('*', async (c, next) => {
      await next()
      c.header('X-Request-ID', c.req.header('x-request-id') || crypto.randomUUID())
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
        return await instance.handler(c.req.raw)
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

      const submitted = await this.extractCsrfToken(request)
      if (!cookieToken || !submitted || cookieToken !== submitted.trim()) {
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

  private registerEntityApiRoutes(): void {
    for (const entity of this.blueprint.entities) {
      const collectionPath = `/api/${entity.name.toLowerCase()}s`
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
        return Response.json(result, { status: 201 })
      }))

      this.app.put(itemPath, async c => this.handleEntityApi(c, entity.name, 'update', async session => {
        this.requireAgentRunId(c.req.raw, session)
        const data = await this.parseJsonObject(c.req.raw)
        return Response.json(await this.queryExecutor.update(entity.name, this.requireEntityId(c.req.param('id')), data, { session }))
      }))

      this.app.delete(itemPath, async c => this.handleEntityApi(c, entity.name, 'delete', async session => {
        this.requireAgentRunId(c.req.raw, session)
        await this.queryExecutor.delete(entity.name, this.requireEntityId(c.req.param('id')), { session })
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
      return await execute(session)
    } catch (error) {
      const label = action === 'get' ? 'Find' : `${action[0]!.toUpperCase()}${action.slice(1)}`
      console.error(`${label} ${entity} error:`, error)
      return Response.json({
        error: `${label} failed`,
        details: error instanceof Error ? error.message : 'Unknown error',
      }, { status: this.entityApiErrorStatus(error) })
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
export function createWorkerHandler(config: Omit<WorkersEngineConfig, 'env'>) {
  return {
    async fetch(request: Request, env: WorkersEnv, _ctx: ExecutionContext): Promise<Response> {
      const engine = new ZebricWorkersEngine({ ...config, env })
      return engine.fetch(request)
    }
  }
}
