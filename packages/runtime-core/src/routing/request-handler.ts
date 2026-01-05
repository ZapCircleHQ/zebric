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
import { AccessControl } from '../database/access-control.js'

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
    const session = await this.getSession(request)
    const flash = this.getFlashMessage(request)

    try {
      // Check auth - Secure by default: require authentication unless explicitly none or optional
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(page.path, 'read', undefined, { session, request })

        if (this.wantsJson(request)) {
          return this.jsonResponse(401, {
            error: 'Authentication required',
            message: 'You must be logged in to access this page',
            login: this.buildLoginRedirect(page, request)
          })
        } else {
          return this.redirectResponse(this.buildLoginRedirect(page, request))
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
        ipAddress: this.extractIp(request),
        userAgent: request.headers['user-agent'] as string
      })

      const csrfToken = this.getCsrfTokenFromCookies(request)

      if (this.wantsJson(request) || !this.renderer) {
        // Return JSON for API requests or if no renderer
        return this.jsonResponse(200, {
          page: page.path,
          title: page.title,
          layout: page.layout,
          data,
          params: match.params,
          query: match.query,
          flash,
          csrfToken
        }, flash ? { 'Set-Cookie': this.clearFlashCookieHeader() } : undefined)
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

        return this.htmlResponse(200, html, flash ? { 'Set-Cookie': this.clearFlashCookieHeader() } : undefined)
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
    const session = await this.getSession(request)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(page.path, 'create', undefined, { session, request })

        return this.jsonResponse(401, {
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
      }

      if (!page.form) {
        return this.jsonResponse(400, { error: 'No form defined for this page' })
      }

      const body = request.body as Record<string, any>

      // Validate form data
      const validationErrors = this.validateForm(page.form, body)
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

        return this.jsonResponse(400, {
          error: 'Validation failed',
          errors: validationErrors
        })
      }

      // Check authorization for create action
      const authorized = await this.checkFormAuthorization(
        page.form,
        'create',
        body,
        session
      )

      if (!authorized) {
        this.auditLogger?.logAccessDenied(page.path, 'create', page.form.entity, { session, request })

        return this.jsonResponse(403, {
          error: 'Access denied',
          message: 'You do not have permission to create this resource'
        })
      }

      // Execute form action
      const result = await this.executeFormAction(page.form, body, {
        params: match.params,
        query: match.query,
        session
      })

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
        const redirectPath = this.replacePlaceholders(
          page.form.onSuccess.redirect,
          { ...match.params, ...result }
        )

        return this.jsonResponse(200, {
          success: true,
          redirect: redirectPath,
          message: page.form.onSuccess.message,
          data: result
        })
      } else {
        return this.jsonResponse(200, {
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
    const session = await this.getSession(request)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(page.path, 'update', undefined, { session, request })

        return this.jsonResponse(401, {
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
      }

      if (!page.form || page.form.method !== 'update') {
        return this.jsonResponse(400, { error: 'No update form defined for this page' })
      }

      const body = request.body as Record<string, any>

      // Validate form data
      const validationErrors = this.validateForm(page.form, body)
      if (validationErrors.length > 0) {
        return this.jsonResponse(400, {
          error: 'Validation failed',
          errors: validationErrors
        })
      }

      // Check authorization for update action
      const updateId = match.params.id || body.id
      const authorized = await this.checkFormAuthorization(
        page.form,
        'update',
        { ...body, id: updateId },
        session,
        updateId
      )

      if (!authorized) {
        this.auditLogger?.logAccessDenied(page.path, 'update', page.form.entity, { session, request })

        return this.jsonResponse(403, {
          error: 'Access denied',
          message: 'You do not have permission to update this resource'
        })
      }

      // Execute update
      const result = await this.executeFormAction(page.form, body, {
        params: match.params,
        query: match.query,
        session
      })

      // Log successful update
      this.auditLogger?.logDataAccess(
        'update',
        page.form.entity,
        match.params.id || result?.id,
        session?.user?.id,
        true,
        { session, request }
      )

      return this.jsonResponse(200, {
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
    const session = await this.getSession(request)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(page.path, 'delete', undefined, { session, request })

        return this.jsonResponse(401, {
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
      }

      if (!page.form || page.form.method !== 'delete') {
        return this.jsonResponse(400, { error: 'No delete action defined for this page' })
      }

      // Check authorization for delete action
      const deleteId = match.params.id
      const authorized = await this.checkFormAuthorization(
        page.form,
        'delete',
        { id: deleteId },
        session,
        deleteId
      )

      if (!authorized) {
        this.auditLogger?.logAccessDenied(page.path, 'delete', page.form.entity, { session, request })

        return this.jsonResponse(403, {
          error: 'Access denied',
          message: 'You do not have permission to delete this resource'
        })
      }

      // Execute delete
      await this.executeFormAction(page.form, {}, {
        params: match.params,
        query: match.query,
        session
      })

      // Log successful delete
      this.auditLogger?.logDataAccess(
        'delete',
        page.form.entity,
        match.params.id,
        session?.user?.id,
        true,
        { session, request }
      )

      return this.jsonResponse(200, {
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

  private async getSession(request: HttpRequest): Promise<any> {
    if (!this.sessionManager) {
      return null
    }

    try {
      return await this.sessionManager.getSession(request)
    } catch (error) {
      console.error('Session retrieval error:', error)
      return null
    }
  }

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

  private async executeFormAction(
    form: Form,
    data: Record<string, any>,
    context: RequestContext
  ): Promise<any> {
    if (!this.queryExecutor) {
      throw new Error('No query executor available')
    }

    try {
      switch (form.method) {
        case 'create':
          return await this.queryExecutor.create(form.entity, data, context)

        case 'update':
          const updateId = context.params?.id || data.id
          if (!updateId) {
            throw new Error('No ID provided for update')
          }
          return await this.queryExecutor.update(form.entity, updateId, data, context)

        case 'delete':
          const deleteId = context.params?.id || data.id
          if (!deleteId) {
            throw new Error('No ID provided for delete')
          }
          await this.queryExecutor.delete(form.entity, deleteId, context)
          return { id: deleteId, deleted: true }

        default:
          throw new Error(`Unknown form method: ${form.method}`)
      }
    } catch (error) {
      console.error('Form action error:', error)
      throw error
    }
  }

  private validateForm(
    form: Form,
    data: Record<string, any>
  ): Array<{ field: string; message: string }> {
    const errors: Array<{ field: string; message: string }> = []

    for (const field of form.fields) {
      const value = data[field.name]

      // Required check
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: field.name,
          message: `${field.label || field.name} is required`
        })
      }

      // Pattern check
      if (field.pattern && value) {
        const regex = new RegExp(field.pattern)
        if (!regex.test(value)) {
          errors.push({
            field: field.name,
            message: field.error_message || 'Invalid format'
          })
        }
      }

      // Min/max checks for numbers
      if (field.type === 'number' && value !== undefined && value !== null) {
        if (field.min !== undefined && value < field.min) {
          errors.push({
            field: field.name,
            message: `Must be at least ${field.min}`
          })
        }
        if (field.max !== undefined && value > field.max) {
          errors.push({
            field: field.name,
            message: `Must be at most ${field.max}`
          })
        }
      }
    }

    return errors
  }

  private replacePlaceholders(template: string, values: Record<string, any>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      return values[key] !== undefined ? String(values[key]) : `{${key}}`
    })
  }

  private async checkFormAuthorization(
    form: Form,
    action: 'create' | 'update' | 'delete',
    data: Record<string, any>,
    session: any,
    recordId?: string
  ): Promise<boolean> {
    // Get entity from blueprint
    if (!this.blueprint?.entities) {
      return false
    }

    const entity = this.blueprint.entities.find((item: any) => item?.name === form.entity)
    if (!entity || typeof entity !== 'object') {
      return false
    }

    // For update/delete, fetch existing record to check ownership
    if ((action === 'update' || action === 'delete') && recordId && this.queryExecutor) {
      try {
        const existingRecord = await this.queryExecutor.findById(form.entity, recordId)
        data = { ...existingRecord, ...data }
      } catch (error) {
        return false
      }
    }

    try {
      const hasAccess = await AccessControl.checkAccess({
        session,
        action,
        entity: entity as any,
        data
      })

      return hasAccess
    } catch (error) {
      console.error('Authorization check error:', error)
      return false
    }
  }

  private wantsJson(request: HttpRequest): boolean {
    const accept = request.headers.accept || ''
    if (!accept) return false
    const wantsJson = accept.includes('application/json')
    const wantsHtml = accept.includes('text/html') || accept.includes('application/xhtml+xml')
    return wantsJson && !wantsHtml
  }

  private buildLoginRedirect(page: Page, request: HttpRequest): string {
    const loginPath = this.findLoginPath()
    const separator = loginPath.includes('?') ? '&' : '?'
    const callbackTarget = this.getCallbackPath(request, page.path)
    const origin = this.resolveOrigin(request)
    const callback = encodeURIComponent(origin + callbackTarget)
    return `${loginPath}${separator}callbackURL=${callback}`
  }

  private findLoginPath(): string {
    const pages = this.blueprint?.pages || []
    const explicit = pages.find((page) => page.path.includes('sign-in') || page.path.includes('login'))
    return explicit?.path || '/auth/sign-in'
  }

  private getCallbackPath(request: HttpRequest, fallbackPath: string): string {
    try {
      const url = new URL(request.url)
      const path = url.pathname + (url.search || '')
      return path.startsWith('/') ? path : `/${path}`
    } catch {
      return fallbackPath.startsWith('/') ? fallbackPath : `/${fallbackPath}`
    }
  }

  private resolveOrigin(request: HttpRequest): string {
    const fallback = new URL(this.defaultOrigin)
    const url = new URL(request.url)
    const protocol = url.protocol.replace(':', '') || fallback.protocol.replace(':', '') || 'http'
    const host = url.host || fallback.host || 'localhost:3000'
    return `${protocol}://${host}`
  }

  private extractIp(request: HttpRequest): string {
    return (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
           (request.headers['x-real-ip'] as string) ||
           'unknown'
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
        ipAddress: this.extractIp(request),
        metadata: this.errorSanitizer.getLogDetails(error)
      })
    }

    return this.jsonResponse(sanitized.statusCode, sanitized)
  }

  private jsonResponse(status: number, data: any, headers: Record<string, string> = {}): HttpResponse {
    return {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data)
    }
  }

  private htmlResponse(status: number, html: string, headers: Record<string, string> = {}): HttpResponse {
    return {
      status,
      headers: { 'Content-Type': 'text/html', ...headers },
      body: html
    }
  }

  private redirectResponse(location: string, headers: Record<string, string> = {}): HttpResponse {
    return {
      status: 303,
      headers: { 'Location': location, ...headers },
      body: ''
    }
  }

  private getFlashMessage(request: HttpRequest): FlashMessage | undefined {
    const cookieHeader = (request.headers['cookie'] as string) || (request.headers['Cookie'] as string)
    if (!cookieHeader) {
      return undefined
    }

    const cookies = this.parseCookies(cookieHeader)
    const raw = cookies['flash']
    if (!raw) {
      return undefined
    }

    try {
      const decoded = decodeURIComponent(raw)
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed.text === 'string') {
        return parsed
      }
    } catch {
      return undefined
    }

    return undefined
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    return cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
      const [name, ...rest] = part.split('=')
      if (!name) return acc
      acc[name.trim()] = rest.join('=').trim()
      return acc
    }, {})
  }

  private clearFlashCookieHeader(): string {
    return 'flash=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
  }

  private getCsrfTokenFromCookies(request: HttpRequest): string | undefined {
    const cookieHeader = (request.headers['cookie'] as string) || (request.headers['Cookie'] as string)
    if (!cookieHeader) {
      return undefined
    }
    const cookies = this.parseCookies(cookieHeader)
    return cookies['csrf-token']
  }
}
