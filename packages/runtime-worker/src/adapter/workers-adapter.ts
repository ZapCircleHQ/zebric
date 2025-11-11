/**
 * CloudFlare Workers Adapter
 *
 * Bridges CloudFlare Workers fetch API to the platform-agnostic RequestHandler from runtime-core.
 * Converts Workers Request/Response to generic HTTP types.
 */

import {
  RequestHandler,
  type HttpRequest,
  type HttpResponse,
  type QueryExecutorPort,
  type SessionManagerPort,
  type RendererPort,
  type AuditLoggerPort,
  type RequestContext,
  RouteMatcher,
  type RouteMatch,
  HTMLRenderer,
  type Theme
} from '@zebric/runtime-core'
import type { Blueprint, Query, UserSession } from '@zebric/runtime-core'
import { D1Adapter } from '../database/d1-adapter.js'
import { KVCache } from '../cache/kv-cache.js'
import { R2Storage } from '../storage/r2-storage.js'
import { WorkersSessionManager } from '../session/session-manager.js'
import { WorkersCSRFProtection } from '../security/csrf-protection.js'
import { WorkersQueryExecutor } from '../query/workers-query-executor.js'

/**
 * Workers adapter config
 */
export interface WorkersAdapterConfig {
  blueprint: Blueprint
  db?: D1Adapter
  cache?: KVCache
  storage?: R2Storage
  sessionManager?: WorkersSessionManager
  csrfProtection?: WorkersCSRFProtection
  renderer?: HTMLRenderer
  theme?: Theme
  defaultOrigin?: string
}

/**
 * CloudFlare Workers-specific adapter that wraps the core RequestHandler
 */
export class WorkersAdapter {
  private requestHandler: RequestHandler
  private routeMatcher: RouteMatcher
  private blueprint: Blueprint
  private sessionManager?: WorkersSessionManager
  private csrfProtection?: WorkersCSRFProtection
  private renderer?: HTMLRenderer

  constructor(config: WorkersAdapterConfig) {
    this.blueprint = config.blueprint
    this.routeMatcher = new RouteMatcher()
    this.sessionManager = config.sessionManager
    this.csrfProtection = config.csrfProtection

    // Create renderer if needed
    if (config.renderer) {
      this.renderer = config.renderer
    } else if (config.theme) {
      this.renderer = new HTMLRenderer(config.blueprint, config.theme)
    }

    // Wrap ports for core RequestHandler
    const queryExecutorPort = config.db ? this.wrapD1Adapter(config.db) : undefined
    const sessionManagerPort = config.sessionManager ? this.wrapSessionManager(config.sessionManager) : undefined
    const rendererPort = this.renderer ? this.wrapRenderer(this.renderer) : undefined

    // Create core request handler
    this.requestHandler = new RequestHandler({
      blueprint: config.blueprint,
      queryExecutor: queryExecutorPort,
      sessionManager: sessionManagerPort,
      renderer: rendererPort,
      defaultOrigin: config.defaultOrigin
    })
  }

  /**
   * Set blueprint (for hot reload)
   */
  setBlueprint(blueprint: Blueprint): void {
    this.blueprint = blueprint
    this.requestHandler.setBlueprint(blueprint)
  }

  /**
   * Handle Workers fetch request
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString()
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    // Match route
    const match = this.routeMatcher.match(url.pathname + url.search, this.blueprint.pages)

    if (!match) {
      return new Response(
        JSON.stringify({ error: 'Page not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    // Convert request and handle based on method
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
        return new Response(
          JSON.stringify({ error: 'Method not allowed' }),
          {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
          }
        )
    }

    return this.convertResponse(httpResponse)
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Convert Workers Request to generic HttpRequest
   */
  private async convertRequest(request: Request): Promise<HttpRequest> {
    // Parse body if present
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
        // Note: File uploads need special handling in Workers
        const formData = await request.formData()
        body = Object.fromEntries(formData as any)
      }
    }

    // Convert headers
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
   * Convert generic HttpResponse to Workers Response
   */
  private convertResponse(httpResponse: HttpResponse): Response {
    const headers = new Headers()

    // Set headers
    for (const [key, value] of Object.entries(httpResponse.headers)) {
      headers.set(key, value)
    }

    // Handle different body types
    let body: BodyInit | null = null

    if (typeof httpResponse.body === 'string') {
      body = httpResponse.body
    } else if (httpResponse.body instanceof ArrayBuffer) {
      body = httpResponse.body
    } else if (httpResponse.body instanceof ReadableStream) {
      body = httpResponse.body
    } else if (httpResponse.body === '') {
      body = null
    }

    return new Response(body, {
      status: httpResponse.status,
      headers
    })
  }

  /**
   * Wrap D1Adapter to match QueryExecutorPort interface
   */
  private wrapD1Adapter(adapter: D1Adapter): QueryExecutorPort {
    // Use the full-featured WorkersQueryExecutor
    return new WorkersQueryExecutor(adapter, this.blueprint)
  }

  /**
   * Wrap WorkersSessionManager to match SessionManagerPort interface
   */
  private wrapSessionManager(manager: WorkersSessionManager): SessionManagerPort {
    return {
      getSession: async (request: HttpRequest) => {
        return manager.getSession(request)
      }
    }
  }

  /**
   * Wrap HTMLRenderer to match RendererPort interface
   */
  private wrapRenderer(renderer: HTMLRenderer): RendererPort {
    return {
      renderPage: (context) => {
        return renderer.renderPage(context as any)
      }
    }
  }
}
