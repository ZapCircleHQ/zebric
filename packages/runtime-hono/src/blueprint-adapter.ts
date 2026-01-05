import {
  RequestHandler,
  RouteMatcher,
  type Blueprint,
  type HttpRequest,
  type HttpResponse,
  type QueryExecutorPort,
  type RendererPort,
  type SessionManagerPort,
  type AuditLoggerPort,
  HTMLRenderer,
  type Theme,
  type ErrorSanitizer
} from '@zebric/runtime-core'
import type { MiddlewareHandler } from 'hono'

export interface BlueprintAdapterConfig {
  blueprint: Blueprint
  queryExecutor?: QueryExecutorPort
  sessionManager?: SessionManagerPort
  renderer?: RendererPort
  auditLogger?: AuditLoggerPort
  errorSanitizer?: ErrorSanitizer
  defaultOrigin?: string
  theme?: Theme
  rendererFactory?: (blueprint: Blueprint, theme?: Theme) => RendererPort
}

/**
 * Bridges fetch-style requests to the core RequestHandler.
 * Designed to be used inside Hono routes on any runtime (Node, Workers, etc).
 */
export class BlueprintHttpAdapter {
  private requestHandler: RequestHandler
  private routeMatcher: RouteMatcher
  private blueprint: Blueprint
  private renderer?: RendererPort
  private rendererFactory?: (blueprint: Blueprint, theme?: Theme) => RendererPort
  private theme?: Theme

  constructor(private config: BlueprintAdapterConfig) {
    this.blueprint = config.blueprint
    this.routeMatcher = new RouteMatcher()
    this.theme = config.theme
    this.rendererFactory = config.rendererFactory

    if (config.renderer) {
      this.renderer = config.renderer
    } else if (config.rendererFactory) {
      this.renderer = config.rendererFactory(config.blueprint, config.theme)
    } else if (config.theme) {
      const htmlRenderer = new HTMLRenderer(config.blueprint, config.theme)
      this.renderer = {
        renderPage: (context) => htmlRenderer.renderPage(context as any)
      }
    }

    this.requestHandler = new RequestHandler({
      blueprint: config.blueprint,
      queryExecutor: config.queryExecutor,
      sessionManager: config.sessionManager,
      renderer: this.renderer,
      auditLogger: config.auditLogger,
      errorSanitizer: config.errorSanitizer,
      defaultOrigin: config.defaultOrigin
    })
  }

  /**
   * Convenience helper to plug the adapter directly into a Hono route.
   */
  toMiddleware(): MiddlewareHandler {
    return async (c) => {
      const response = await this.handle(c.req.raw)
      return response
    }
  }

  /**
   * Update blueprint (hot reload)
   */
  setBlueprint(blueprint: Blueprint): void {
    this.blueprint = blueprint
    if (this.rendererFactory) {
      this.renderer = this.rendererFactory(blueprint, this.theme)
    }

    this.requestHandler.setBlueprint(blueprint)
  }

  /**
   * Fetch-style handler that can be used by Hono or any runtime implementing Request/Response.
   */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const match = this.routeMatcher.match(url.pathname + url.search, this.blueprint.pages)

    if (!match) {
      return new Response(JSON.stringify({ error: 'Page not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const httpRequest = await this.convertRequest(request)
    let httpResponse: HttpResponse

    switch (request.method) {
      case 'GET':
        httpResponse = await this.requestHandler.handleGet(match, httpRequest)
        break
      case 'POST':
        httpResponse = await this.requestHandler.handlePost(match, httpRequest)
        break
      case 'PUT':
        httpResponse = await this.requestHandler.handlePut(match, httpRequest)
        break
      case 'DELETE':
        httpResponse = await this.requestHandler.handleDelete(match, httpRequest)
        break
      default:
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        })
    }

    return this.convertResponse(httpResponse)
  }

  /**
   * Convert Request to HttpRequest expected by RequestHandler.
   */
  private async convertRequest(request: Request): Promise<HttpRequest> {
    let body: any
    const contentType = request.headers.get('content-type') || ''

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (contentType.includes('application/json')) {
        try {
          body = await request.json()
        } catch {
          body = undefined
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData()
        body = Object.fromEntries(formData as any)
      } else if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData()
        body = Object.fromEntries(formData as any)
      } else {
        body = await request.text()
      }
    }

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    return {
      method: request.method,
      url: request.url,
      headers,
      body
    }
  }

  /**
   * Convert HttpResponse back to a standard Response.
   */
  private convertResponse(httpResponse: HttpResponse): Response {
    const headers = new Headers()
    for (const [key, value] of Object.entries(httpResponse.headers)) {
      headers.set(key, value)
    }

    let body: BodyInit | null = null
    if (typeof httpResponse.body === 'string') {
      body = httpResponse.body
    } else if (httpResponse.body instanceof ArrayBuffer) {
      body = httpResponse.body
    } else if (httpResponse.body instanceof ReadableStream) {
      body = httpResponse.body
    } else if (httpResponse.body == null) {
      body = null
    } else if (typeof httpResponse.body === 'object') {
      body = JSON.stringify(httpResponse.body)
      headers.set('Content-Type', headers.get('Content-Type') || 'application/json')
    }

    return new Response(body, {
      status: httpResponse.status,
      headers
    })
  }
}
