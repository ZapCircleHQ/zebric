/**
 * Zebric Workers Engine
 *
 * CloudFlare Workers adapter for Zebric runtime.
 */

import { BlueprintParser, detectFormat, ErrorSanitizer, HTMLRenderer, SessionManager, defaultTheme, analyzeTransactionalWorkflow, getInjectedCsrfTokenFromRequest, injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { AuthProvider, Blueprint, SessionManagerPort, TemplateLoader, Theme } from '@zebric/runtime-core'
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
import { R2Storage } from './storage/r2-storage.js'

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

    const queryExecutor = new WorkersQueryExecutor(this.db, this.blueprint)
    const rendererPort = {
      renderPage: (context: any) => this.renderer.renderPage(context)
    }

    // Initialize adapter
    this.adapter = new BlueprintHttpAdapter({
      blueprint: this.blueprint,
      queryExecutor,
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
      queryExecutor,
      sessionManager: this.sessionManager,
    })
    registerSearchRoutes(this.app, {
      blueprint: this.blueprint,
      queryExecutor,
      sessionManager: this.sessionManager,
    })

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
