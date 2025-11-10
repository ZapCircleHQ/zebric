/**
 * Fastify Adapter
 *
 * Bridges Fastify HTTP server to the platform-agnostic RequestHandler from runtime-core.
 * Converts Fastify requests/responses to generic HTTP types.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
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
  type RouteMatch
} from '@zebric/runtime-core'
import type { Blueprint, Query, UserSession } from '@zebric/runtime-core'
import type { QueryExecutor } from '../database/index.js'
import { HTMLRenderer } from '../renderer/index.js'
import type { Theme } from '@zebric/runtime-core'
import type { PluginRegistry } from '../plugins/index.js'
import { AuditLogger } from '../security/index.js'
import { ErrorSanitizer } from '@zebric/runtime-core'

/**
 * Adapter config
 */
export interface FastifyAdapterConfig {
  blueprint: Blueprint
  queryExecutor?: QueryExecutor
  sessionManager?: any // SessionManager from runtime-node
  auditLogger?: AuditLogger
  errorSanitizer?: ErrorSanitizer
  pluginRegistry?: PluginRegistry
  defaultOrigin?: string
  theme?: Theme
  rendererClass?: typeof HTMLRenderer
}

/**
 * Fastify-specific adapter that wraps the core RequestHandler
 */
export class FastifyAdapter {
  private requestHandler: RequestHandler
  private routeMatcher: RouteMatcher
  private blueprint: Blueprint
  private sessionManager?: any
  private renderer?: HTMLRenderer

  constructor(config: FastifyAdapterConfig) {
    this.blueprint = config.blueprint
    this.sessionManager = config.sessionManager
    this.routeMatcher = new RouteMatcher()

    // Create renderer if provided
    if (config.blueprint) {
      const RendererClass = config.rendererClass || HTMLRenderer
      this.renderer = new RendererClass(config.blueprint, config.theme)
    }

    // Wrap ports for core RequestHandler
    const queryExecutorPort = config.queryExecutor ? this.wrapQueryExecutor(config.queryExecutor) : undefined
    const sessionManagerPort = config.sessionManager ? this.wrapSessionManager(config.sessionManager) : undefined
    const rendererPort = this.renderer ? this.wrapRenderer(this.renderer) : undefined
    const auditLoggerPort = config.auditLogger ? this.wrapAuditLogger(config.auditLogger) : undefined

    // Create core request handler
    this.requestHandler = new RequestHandler({
      blueprint: config.blueprint,
      queryExecutor: queryExecutorPort,
      sessionManager: sessionManagerPort,
      renderer: rendererPort,
      auditLogger: auditLoggerPort,
      errorSanitizer: config.errorSanitizer,
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
   * Handle Fastify GET request
   */
  async handleGet(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    const match = this.routeMatcher.match(url.pathname + url.search, this.blueprint.pages)

    if (!match) {
      reply.code(404).send({ error: 'Page not found' })
      return
    }

    const httpRequest = this.convertRequest(request)
    const httpResponse = await this.requestHandler.handleGet(match, httpRequest)
    await this.sendResponse(reply, httpResponse)
  }

  /**
   * Handle Fastify POST request
   */
  async handlePost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    const match = this.routeMatcher.match(url.pathname + url.search, this.blueprint.pages)

    if (!match) {
      reply.code(404).send({ error: 'Page not found' })
      return
    }

    const httpRequest = this.convertRequest(request)
    const httpResponse = await this.requestHandler.handlePost(match, httpRequest)
    await this.sendResponse(reply, httpResponse)
  }

  /**
   * Handle Fastify PUT request
   */
  async handlePut(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    const match = this.routeMatcher.match(url.pathname + url.search, this.blueprint.pages)

    if (!match) {
      reply.code(404).send({ error: 'Page not found' })
      return
    }

    const httpRequest = this.convertRequest(request)
    const httpResponse = await this.requestHandler.handlePut(match, httpRequest)
    await this.sendResponse(reply, httpResponse)
  }

  /**
   * Handle Fastify DELETE request
   */
  async handleDelete(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    const match = this.routeMatcher.match(url.pathname + url.search, this.blueprint.pages)

    if (!match) {
      reply.code(404).send({ error: 'Page not found' })
      return
    }

    const httpRequest = this.convertRequest(request)
    const httpResponse = await this.requestHandler.handleDelete(match, httpRequest)
    await this.sendResponse(reply, httpResponse)
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Convert Fastify request to generic HttpRequest
   */
  private convertRequest(request: FastifyRequest): HttpRequest {
    return {
      method: request.method,
      url: request.url,
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body
    }
  }

  /**
   * Send generic HttpResponse via Fastify reply
   */
  private async sendResponse(reply: FastifyReply, response: HttpResponse): Promise<void> {
    // Set headers
    for (const [key, value] of Object.entries(response.headers)) {
      reply.header(key, value)
    }

    // Handle redirects
    if (response.status === 303 && response.headers['Location']) {
      reply.redirect(response.headers['Location'], response.status)
      return
    }

    // Send body
    reply.code(response.status)

    if (typeof response.body === 'string') {
      reply.send(response.body)
    } else if (response.body instanceof ArrayBuffer) {
      reply.send(Buffer.from(response.body))
    } else if (response.body instanceof ReadableStream) {
      // Convert ReadableStream to Node stream
      reply.send(this.readableStreamToNodeStream(response.body))
    } else {
      reply.send(response.body)
    }
  }

  /**
   * Convert Web ReadableStream to Node.js stream
   */
  private readableStreamToNodeStream(stream: ReadableStream): NodeJS.ReadableStream {
    const reader = stream.getReader()
    const { Readable } = require('stream')

    return new Readable({
      async read() {
        try {
          const { done, value } = await reader.read()
          if (done) {
            this.push(null)
          } else {
            this.push(Buffer.from(value))
          }
        } catch (error) {
          this.destroy(error as Error)
        }
      }
    })
  }

  /**
   * Wrap QueryExecutor to match QueryExecutorPort interface
   */
  private wrapQueryExecutor(executor: QueryExecutor): QueryExecutorPort {
    return {
      execute: async (query: Query, context: RequestContext) => {
        return executor.execute(query, context)
      },
      create: async (entity: string, data: Record<string, any>, context: RequestContext) => {
        return executor.create(entity, data, context)
      },
      update: async (entity: string, id: string, data: Record<string, any>, context: RequestContext) => {
        return executor.update(entity, id, data, context)
      },
      delete: async (entity: string, id: string, context: RequestContext) => {
        await executor.delete(entity, id, context)
      },
      findById: async (entity: string, id: string) => {
        return executor.findById(entity, id)
      }
    }
  }

  /**
   * Wrap SessionManager to match SessionManagerPort interface
   */
  private wrapSessionManager(manager: any): SessionManagerPort {
    return {
      getSession: async (request: HttpRequest) => {
        // SessionManager expects Fastify request, so we need to pass the original
        // This is a temporary workaround - ideally SessionManager should be platform-agnostic
        return manager.getSession(request as any)
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

  /**
   * Wrap AuditLogger to match AuditLoggerPort interface
   */
  private wrapAuditLogger(logger: AuditLogger): AuditLoggerPort {
    return {
      log: (event) => {
        logger.log(event as any)
      },
      logAccessDenied: (resource, action, entity, context) => {
        logger.logAccessDenied(resource, action, entity, context)
      },
      logDataAccess: (action, entity, recordId, userId, success, context) => {
        logger.logDataAccess(action as 'read' | 'create' | 'update' | 'delete', entity, recordId, userId, success ?? true, context)
      }
    }
  }
}
