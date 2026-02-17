/**
 * Request Handler (Platform-Agnostic)
 *
 * Handles HTTP requests for Blueprint pages.
 * Supports GET, POST, PUT, DELETE methods.
 * Platform-specific adapters wrap this core logic.
 */

import type { Blueprint, Page, Query, Form } from '../types/blueprint.js'
import type { RouteMatch } from './route-matcher.js'
import type {
  HttpRequest,
  HttpResponse,
  RequestContext,
  QueryExecutorPort,
  SessionManagerPort,
  RendererPort,
  AuditLoggerPort,
  FileStoragePort,
  AuthorizationPort,
  RenderContext,
  FlashMessage
} from './request-ports.js'
import { ErrorSanitizer } from '../security/error-sanitizer.js'
import {
  wantsJson,
  jsonResponse,
  htmlResponse,
  redirectResponse,
  getFlashMessage,
  clearFlashCookieHeader,
  getCsrfTokenFromCookies,
  extractIp,
  replacePlaceholders
} from './request-utils.js'
import { executeFormAction, validateForm, checkFormAuthorization } from './form-processor.js'
import { resolveSession, buildLoginRedirect } from './session-resolver.js'

export interface RequestHandlerConfig {
  blueprint: Blueprint
  queryExecutor?: QueryExecutorPort
  sessionManager?: SessionManagerPort
  renderer?: RendererPort
  auditLogger?: AuditLoggerPort
  fileStorage?: FileStoragePort
  errorSanitizer?: ErrorSanitizer
  defaultOrigin?: string
}

export class RequestHandler {
  private blueprint: Blueprint
  private queryExecutor?: QueryExecutorPort
  private sessionManager?: SessionManagerPort
  private renderer?: RendererPort
  private auditLogger?: AuditLoggerPort
  private fileStorage?: FileStoragePort
  private errorSanitizer?: ErrorSanitizer
  private defaultOrigin: string

  constructor(config: RequestHandlerConfig) {
    this.blueprint = config.blueprint
    this.queryExecutor = config.queryExecutor
    this.sessionManager = config.sessionManager
    this.renderer = config.renderer
    this.auditLogger = config.auditLogger
    this.fileStorage = config.fileStorage
    this.errorSanitizer = config.errorSanitizer
    this.defaultOrigin = config.defaultOrigin || 'http://localhost:3000'
  }

  /**
   * Update blueprint (for hot reload)
   */
  setBlueprint(blueprint: Blueprint): void {
    this.blueprint = blueprint
  }

  /**
   * Handle GET request - render page or return data
   */
  async handleGet(
    match: RouteMatch,
    request: HttpRequest
  ): Promise<HttpResponse> {
    const page = match.page
    const session = await resolveSession(request, this.sessionManager)
    const flash = getFlashMessage(request)

    try {
      // Check auth - Secure by default: require authentication unless explicitly none or optional
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(page.path, 'read', undefined, { session, request })

        if (wantsJson(request)) {
          return jsonResponse(401, {
            error: 'Authentication required',
            message: 'You must be logged in to access this page',
            login: buildLoginRedirect(page, request, this.blueprint, this.defaultOrigin)
          })
        } else {
          return redirectResponse(buildLoginRedirect(page, request, this.blueprint, this.defaultOrigin))
        }
      }

      // Execute queries
      const data: Record<string, any> = {}
      if (page.queries) {
        for (const [name, queryDef] of Object.entries(page.queries)) {
          data[name] = await this.executeQuery(queryDef, {
            params: match.params,
            query: match.query,
            session
          })
        }
      }

      // Log successful access
      this.auditLogger?.log({
        eventType: 'DATA_READ',
        severity: 'INFO',
        action: `View page: ${page.path}`,
        resource: page.path,
        success: true,
        userId: session?.user?.id,
        ipAddress: extractIp(request),
        userAgent: request.headers['user-agent'] as string
      })

      const csrfToken = getCsrfTokenFromCookies(request)

      if (wantsJson(request) || !this.renderer) {
        // Return JSON for API requests or if no renderer
        return jsonResponse(200, {
          page: page.path,
          title: page.title,
          layout: page.layout,
          data,
          params: match.params,
          query: match.query,
          flash,
          csrfToken
        }, flash ? { 'Set-Cookie': clearFlashCookieHeader() } : undefined)
      } else {
        // Render HTML
        const html = this.renderer.renderPage({
          page,
          data,
          params: match.params,
          query: match.query,
          session,
          flash,
          csrfToken
        })

        return htmlResponse(200, html, flash ? { 'Set-Cookie': clearFlashCookieHeader() } : undefined)
      }
    } catch (error) {
      return this.handleError(error, session, page.path, request)
    }
  }

  /**
   * Handle POST request - create resource or submit form
   */
  async handlePost(
    match: RouteMatch,
    request: HttpRequest
  ): Promise<HttpResponse> {
    const page = match.page
    const session = await resolveSession(request, this.sessionManager)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(page.path, 'create', undefined, { session, request })

        return jsonResponse(401, {
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
      }

      if (!page.form) {
        return jsonResponse(400, { error: 'No form defined for this page' })
      }

      const body = request.body as Record<string, any>

      // Validate form data
      const validationErrors = validateForm(page.form, body)
      if (validationErrors.length > 0) {
        this.auditLogger?.log({
          eventType: 'INVALID_INPUT',
          severity: 'WARNING',
          action: 'Form validation failed',
          resource: page.path,
          success: false,
          userId: session?.user?.id,
          metadata: { errors: validationErrors }
        })

        return jsonResponse(400, {
          error: 'Validation failed',
          errors: validationErrors
        })
      }

      // Check authorization for create action
      const authorized = await checkFormAuthorization(
        page.form,
        'create',
        body,
        session,
        this.blueprint,
        this.queryExecutor
      )

      if (!authorized) {
        this.auditLogger?.logAccessDenied(page.path, 'create', page.form.entity, { session, request })

        return jsonResponse(403, {
          error: 'Access denied',
          message: 'You do not have permission to create this resource'
        })
      }

      // Execute form action
      const result = await executeFormAction(page.form, body, {
        params: match.params,
        query: match.query,
        session
      }, this.queryExecutor)

      // Log successful create
      this.auditLogger?.logDataAccess(
        'create',
        page.form.entity,
        result?.id,
        session?.user?.id,
        true,
        { session, request }
      )

      // Handle success
      if (page.form.onSuccess?.redirect) {
        const redirectPath = replacePlaceholders(
          page.form.onSuccess.redirect,
          { ...match.params, ...result }
        )

        return jsonResponse(200, {
          success: true,
          redirect: redirectPath,
          message: page.form.onSuccess.message,
          data: result
        })
      } else {
        return jsonResponse(200, {
          success: true,
          message: page.form.onSuccess?.message || 'Success',
          data: result
        })
      }
    } catch (error) {
      return this.handleError(error, session, page.path, request)
    }
  }

  /**
   * Handle PUT request - update resource
   */
  async handlePut(
    match: RouteMatch,
    request: HttpRequest
  ): Promise<HttpResponse> {
    const page = match.page
    const session = await resolveSession(request, this.sessionManager)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(page.path, 'update', undefined, { session, request })

        return jsonResponse(401, {
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
      }

      if (!page.form || page.form.method !== 'update') {
        return jsonResponse(400, { error: 'No update form defined for this page' })
      }

      const body = request.body as Record<string, any>

      // Validate form data (skip required checks for partial updates)
      const validationErrors = validateForm(page.form, body, true)
      if (validationErrors.length > 0) {
        return jsonResponse(400, {
          error: 'Validation failed',
          errors: validationErrors
        })
      }

      // Check authorization for update action
      const updateId = match.params.id || body.id
      const authorized = await checkFormAuthorization(
        page.form,
        'update',
        { ...body, id: updateId },
        session,
        this.blueprint,
        this.queryExecutor,
        updateId
      )

      if (!authorized) {
        this.auditLogger?.logAccessDenied(page.path, 'update', page.form.entity, { session, request })

        return jsonResponse(403, {
          error: 'Access denied',
          message: 'You do not have permission to update this resource'
        })
      }

      // Execute update
      const result = await executeFormAction(page.form, body, {
        params: match.params,
        query: match.query,
        session
      }, this.queryExecutor)

      // Log successful update
      this.auditLogger?.logDataAccess(
        'update',
        page.form.entity,
        match.params.id || result?.id,
        session?.user?.id,
        true,
        { session, request }
      )

      return jsonResponse(200, {
        success: true,
        message: 'Updated successfully',
        data: result
      })
    } catch (error) {
      return this.handleError(error, session, page.path, request)
    }
  }

  /**
   * Handle DELETE request - delete resource
   */
  async handleDelete(
    match: RouteMatch,
    request: HttpRequest
  ): Promise<HttpResponse> {
    const page = match.page
    const session = await resolveSession(request, this.sessionManager)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(page.path, 'delete', undefined, { session, request })

        return jsonResponse(401, {
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
      }

      if (!page.form || page.form.method !== 'delete') {
        return jsonResponse(400, { error: 'No delete action defined for this page' })
      }

      // Check authorization for delete action
      const deleteId = match.params.id
      const authorized = await checkFormAuthorization(
        page.form,
        'delete',
        { id: deleteId },
        session,
        this.blueprint,
        this.queryExecutor,
        deleteId
      )

      if (!authorized) {
        this.auditLogger?.logAccessDenied(page.path, 'delete', page.form.entity, { session, request })

        return jsonResponse(403, {
          error: 'Access denied',
          message: 'You do not have permission to delete this resource'
        })
      }

      // Execute delete
      await executeFormAction(page.form, {}, {
        params: match.params,
        query: match.query,
        session
      }, this.queryExecutor)

      // Log successful delete
      this.auditLogger?.logDataAccess(
        'delete',
        page.form.entity,
        match.params.id,
        session?.user?.id,
        true,
        { session, request }
      )

      return jsonResponse(200, {
        success: true,
        message: 'Deleted successfully'
      })
    } catch (error) {
      return this.handleError(error, session, page.path, request)
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async executeQuery(queryDef: Query, context: RequestContext): Promise<any> {
    if (!this.queryExecutor) {
      console.warn('No query executor available, returning empty array')
      return []
    }

    try {
      return await this.queryExecutor.execute(queryDef, context)
    } catch (error) {
      console.error('Query execution error:', error)
      return []
    }
  }

  private handleError(error: any, session: any, resource: string, request: HttpRequest): HttpResponse {
    const sanitized = this.errorSanitizer?.sanitize(error) || {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An error occurred'
    }

    if (this.errorSanitizer?.shouldLog(error)) {
      this.auditLogger?.log({
        eventType: 'ERROR',
        severity: 'ERROR',
        action: `Error on ${resource}`,
        resource,
        success: false,
        userId: session?.user?.id,
        ipAddress: extractIp(request),
        metadata: this.errorSanitizer.getLogDetails(error)
      })
    }

    return jsonResponse(sanitized.statusCode, sanitized)
  }
}
