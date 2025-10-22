/**
 * Route Handler
 *
 * Handles HTTP requests for Blueprint pages.
 * Supports GET, POST, PUT, DELETE methods.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import type { Query, Form, Blueprint, Page } from '../types/blueprint.js'
import type { RouteMatch } from './route-matcher.js'
import { HTMLRenderer, type Theme } from '../renderer/index.js'
import type { QueryExecutor } from '../database/index.js'
import type { SessionManager, UserSession } from '../auth/index.js'
import type { PluginRegistry } from '../plugins/index.js'
import { AuditLogger, AuditEventType, AuditSeverity, ErrorSanitizer } from '../security/index.js'
import { BehaviorExecutor } from './behavior-executor.js'
import { FileStorage } from '../storage/index.js'

export interface RouteContext {
  params: Record<string, string>
  query: Record<string, string>
  body?: any
  session?: UserSession | null
}

export class RouteHandler {
  private renderer?: HTMLRenderer
  private queryExecutor?: QueryExecutor
  private sessionManager?: SessionManager
  private auditLogger?: AuditLogger
  private errorSanitizer?: ErrorSanitizer
  private pluginRegistry?: PluginRegistry
  private blueprint?: Blueprint
  private theme?: Theme
  private rendererClass: typeof HTMLRenderer
  private readonly defaultOrigin: string
  private behaviorExecutor?: BehaviorExecutor
  private fileStorage: FileStorage

  constructor(
    blueprint?: Blueprint,
    queryExecutor?: QueryExecutor,
    sessionManager?: SessionManager,
    auditLogger?: AuditLogger,
    errorSanitizer?: ErrorSanitizer,
    pluginRegistry?: PluginRegistry,
    defaultOrigin: string = 'http://localhost:3000',
    theme?: Theme,
    rendererClass?: typeof HTMLRenderer,
    fileStorage?: FileStorage
  ) {
    if (blueprint) {
      this.blueprint = blueprint
      this.rendererClass = rendererClass || HTMLRenderer
      this.renderer = new this.rendererClass(blueprint, theme, pluginRegistry)
    } else {
      this.rendererClass = rendererClass || HTMLRenderer
    }
    this.queryExecutor = queryExecutor
    this.sessionManager = sessionManager
    this.auditLogger = auditLogger
    this.errorSanitizer = errorSanitizer
    this.pluginRegistry = pluginRegistry
    this.theme = theme
    this.defaultOrigin = defaultOrigin
    this.fileStorage = fileStorage || new FileStorage()
  }

  /**
   * Set blueprint (for hot reload)
   */
  setBlueprint(blueprint: Blueprint, blueprintPath?: string): void {
    this.blueprint = blueprint
    this.renderer = new this.rendererClass(blueprint, this.theme, this.pluginRegistry)
    if (blueprintPath) {
      this.behaviorExecutor = new BehaviorExecutor(blueprintPath)
    }
  }

  /**
   * Set plugin registry
   */
  setPluginRegistry(pluginRegistry: PluginRegistry): void {
    this.pluginRegistry = pluginRegistry
    if (this.blueprint) {
      this.renderer = new this.rendererClass(this.blueprint, this.theme, this.pluginRegistry)
    }
  }

  /**
   * Set theme
   */
  setTheme(theme: Theme): void {
    this.theme = theme
    if (this.blueprint) {
      this.renderer = new this.rendererClass(this.blueprint, this.theme, this.pluginRegistry)
    }
  }

  /**
   * Set query executor
   */
  setQueryExecutor(queryExecutor: QueryExecutor): void {
    this.queryExecutor = queryExecutor
  }

  /**
   * Set session manager
   */
  setSessionManager(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager
  }

  /**
   * Set audit logger
   */
  setAuditLogger(auditLogger: AuditLogger): void {
    this.auditLogger = auditLogger
  }

  /**
   * Set error sanitizer
   */
  setErrorSanitizer(errorSanitizer: ErrorSanitizer): void {
    this.errorSanitizer = errorSanitizer
  }

  private wantsJson(request: FastifyRequest): boolean {
    const accept = request.headers.accept || ''
    if (!accept) return false
    const wantsJson = accept.includes('application/json')
    const wantsHtml = accept.includes('text/html') || accept.includes('application/xhtml+xml')
    return wantsJson && !wantsHtml
  }

  private prefersJson(request: FastifyRequest): boolean {
    const contentType = String(request.headers['content-type'] || '')
    if (contentType.includes('application/json')) {
      return true
    }

    const accept = request.headers.accept || ''
    if (!accept) return false

    const wantsJson = accept.includes('application/json')
    const wantsHtml = accept.includes('text/html') || accept.includes('application/xhtml+xml')
    return wantsJson && !wantsHtml
  }

  private buildLoginRedirect(page: Page, request: FastifyRequest): string {
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

  private getCallbackPath(request: FastifyRequest, fallbackPath: string): string {
    const rawUrl = request.raw?.url || request.url || fallbackPath || '/'
    try {
      const url = new URL(rawUrl, 'http://localhost')
      const path = url.pathname + (url.search || '')
      return path.startsWith('/') ? path : `/${path}`
    } catch {
      if (rawUrl.startsWith('/')) return rawUrl
      return fallbackPath.startsWith('/') ? fallbackPath : `/${fallbackPath}`
    }
  }

  private resolveOrigin(request: FastifyRequest): string {
    const fallback = new URL(this.defaultOrigin)
    const protocol = request.protocol || fallback.protocol.replace(':', '') || 'http'
    const hostHeader = request.headers.host || request.hostname
    let host = hostHeader ? hostHeader.split(',')[0].trim() : ''

    if (!host || host.startsWith('0.0.0.0') || host.startsWith('::')) {
      host = fallback.host || 'localhost:3000'
    }

    return `${protocol}://${host}`
  }

  /**
   * Handle GET request - render page or return data
   */
  async handleGet(
    match: RouteMatch,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const page = match.page
    const session = await this.getSession(request)

    try {
      // Check auth - Secure by default: require authentication unless explicitly none or optional
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        this.auditLogger?.logAccessDenied(
          page.path,
          'read',
          undefined,
          AuditLogger.extractContext(session, request)
        )

        if (this.wantsJson(request)) {
          reply.code(401).send({
            error: 'Authentication required',
            message: 'You must be logged in to access this page',
            login: this.buildLoginRedirect(page, request),
          })
        } else {
          reply.redirect(this.buildLoginRedirect(page, request), 303)
        }
        return
      }

      // Execute queries
      const data: Record<string, any> = {}
      if (page.queries) {
        for (const [name, queryDef] of Object.entries(page.queries)) {
          data[name] = await this.executeQuery(queryDef, {
            params: match.params,
            query: match.query,
            session,
          })
        }
      }

      // Log successful access
      this.auditLogger?.log({
        eventType: AuditEventType.DATA_READ,
        severity: AuditSeverity.INFO,
        action: `View page: ${page.path}`,
        resource: page.path,
        success: true,
        ...AuditLogger.extractContext(session, request),
      })

      if (this.wantsJson(request) || !this.renderer) {
        // Return JSON for API requests or if no renderer
        reply.send({
          page: page.path,
          title: page.title,
          layout: page.layout,
          data,
          params: match.params,
          query: match.query,
        })
      } else {
        // Check if page has custom behavior
        if (page.behavior?.render && this.behaviorExecutor) {
          try {
            const html = await this.behaviorExecutor.executeRender(page.behavior, {
              data,
              helpers: {} as any, // Helpers are created inside BehaviorExecutor
              params: match.params,
              session,
            })
            reply.type('text/html').send(html)
          } catch (error) {
            console.error('Behavior execution error:', error)
            // Fall back to standard renderer
            const csrfToken = await reply.generateCsrf()
            const html = this.renderer.renderPage({
              page,
              data,
              params: match.params,
              query: match.query,
              session,
              csrfToken,
            })
            reply.type('text/html').send(html)
          }
        } else {
          // Render HTML using standard renderer
          const csrfToken = await reply.generateCsrf()
          const html = this.renderer.renderPage({
            page,
            data,
            params: match.params,
            query: match.query,
            session,
            csrfToken,
          })

          reply.type('text/html').send(html)
        }
      }
    } catch (error) {
      // Sanitize error
      const sanitized = this.errorSanitizer?.sanitize(error) || {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An error occurred'
      }

      // Log error
      if (this.errorSanitizer?.shouldLog(error)) {
        this.auditLogger?.logSuspiciousActivity(
          `Error on ${page.path}`,
          AuditSeverity.ERROR,
          {
            ...AuditLogger.extractContext(session, request),
            errorMessage: sanitized.message,
            metadata: this.errorSanitizer.getLogDetails(error),
          }
        )
      }

      reply.code(sanitized.statusCode).send(sanitized)
    }
  }

  /**
   * Handle POST request - create resource or submit form
   */
  async handlePost(
    match: RouteMatch,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const page = match.page
    const session = await this.getSession(request)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        // Log access denied
        this.auditLogger?.logAccessDenied(
          page.path,
          'create',
          undefined,
          AuditLogger.extractContext(session, request)
        )

        reply.code(401).send({
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
        return
      }

      if (!page.form) {
        reply.code(400).send({ error: 'No form defined for this page' })
        return
      }

      // Get form data (handle multipart if there are file fields)
      let body: Record<string, any>

      if (this.hasFileFields(page.form)) {
        body = await this.processMultipartForm(request, page.form)
      } else {
        body = request.body as Record<string, any>
      }

      // Validate form data
      const validationErrors = this.validateForm(page.form, body)
      if (validationErrors.length > 0) {
        // Log validation failure
        this.auditLogger?.log({
          eventType: AuditEventType.INVALID_INPUT,
          severity: AuditSeverity.WARNING,
          action: 'Form validation failed',
          resource: page.path,
          success: false,
          metadata: { errors: validationErrors },
          ...AuditLogger.extractContext(session, request),
        })

        reply.code(400).send({
          error: 'Validation failed',
          errors: validationErrors,
        })
        return
      }

      // Check authorization for create action
      const authorized = await this.checkFormAuthorization(
        page.form,
        'create',
        body,
        session
      )

      if (!authorized) {
        this.auditLogger?.logAccessDenied(
          page.path,
          'create',
          page.form.entity,
          AuditLogger.extractContext(session, request)
        )

        reply.code(403).send({
          error: 'Access denied',
          message: 'You do not have permission to create this resource'
        })
        return
      }

      // Execute form action
      const result = await this.executeFormAction(page.form, body, {
        params: match.params,
        query: match.query,
        session,
      })

      // Log successful create
      this.auditLogger?.logDataAccess(
        'create',
        page.form.entity,
        result?.id,
        session?.user?.id,
        true,
        AuditLogger.extractContext(session, request)
      )

      // Handle success
      const prefersJson = this.prefersJson(request) || this.wantsJson(request)

      if (page.form.onSuccess?.redirect) {
        const redirectPath = this.replacePlaceholders(
          page.form.onSuccess.redirect,
          { ...match.params, ...result }
        )
        if (prefersJson) {
          reply.send({
            success: true,
            redirect: redirectPath,
            message: page.form.onSuccess.message,
            data: result,
          })
        } else {
          reply.redirect(redirectPath, 303)
        }
      } else {
        if (prefersJson) {
          reply.send({
            success: true,
            message: page.form.onSuccess?.message || 'Success',
            data: result,
          })
        } else {
          reply.redirect(page.path, 303)
        }
      }
    } catch (error) {
      // Sanitize error
      const sanitized = this.errorSanitizer?.sanitize(error) || {
        statusCode: 500,
        error: page.form?.onError?.message || 'An error occurred',
        message: error instanceof Error ? error.message : 'Unknown error',
      }

      // Log failed create
      this.auditLogger?.logDataAccess(
        'create',
        page.form?.entity || 'unknown',
        undefined,
        session?.user?.id,
        false,
        {
          ...AuditLogger.extractContext(session, request),
          errorMessage: sanitized.message,
        }
      )

      reply.code(sanitized.statusCode).send(sanitized)
    }
  }

  /**
   * Handle PUT request - update resource
   */
  async handlePut(
    match: RouteMatch,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const page = match.page
    const session = await this.getSession(request)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        // Log access denied
        this.auditLogger?.logAccessDenied(
          page.path,
          'update',
          undefined,
          AuditLogger.extractContext(session, request)
        )

        reply.code(401).send({
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
        return
      }

      if (!page.form || page.form.method !== 'update') {
        reply.code(400).send({ error: 'No update form defined for this page' })
        return
      }

      // Get form data (handle multipart if there are file fields)
      let body: Record<string, any>

      if (this.hasFileFields(page.form)) {
        body = await this.processMultipartForm(request, page.form)
      } else {
        body = request.body as Record<string, any>
      }

      // Validate form data
      const validationErrors = this.validateForm(page.form, body)
      if (validationErrors.length > 0) {
        // Log validation failure
        this.auditLogger?.log({
          eventType: AuditEventType.INVALID_INPUT,
          severity: AuditSeverity.WARNING,
          action: 'Update validation failed',
          resource: page.path,
          success: false,
          metadata: { errors: validationErrors },
          ...AuditLogger.extractContext(session, request),
        })

        reply.code(400).send({
          error: 'Validation failed',
          errors: validationErrors,
        })
        return
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
        this.auditLogger?.logAccessDenied(
          page.path,
          'update',
          page.form.entity,
          AuditLogger.extractContext(session, request)
        )

        reply.code(403).send({
          error: 'Access denied',
          message: 'You do not have permission to update this resource'
        })
        return
      }

      // Execute update
      const result = await this.executeFormAction(page.form, body, {
        params: match.params,
        query: match.query,
        session,
      })

      // Log successful update
      this.auditLogger?.logDataAccess(
        'update',
        page.form.entity,
        match.params.id || result?.id,
        session?.user?.id,
        true,
        AuditLogger.extractContext(session, request)
      )

      reply.send({
        success: true,
        message: 'Updated successfully',
        data: result,
      })
    } catch (error) {
      // Sanitize error
      const sanitized = this.errorSanitizer?.sanitize(error) || {
        statusCode: 500,
        error: 'Update failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }

      // Log failed update
      this.auditLogger?.logDataAccess(
        'update',
        page.form?.entity || 'unknown',
        match.params.id,
        session?.user?.id,
        false,
        {
          ...AuditLogger.extractContext(session, request),
          errorMessage: sanitized.message,
        }
      )

      reply.code(sanitized.statusCode).send(sanitized)
    }
  }

  /**
   * Handle DELETE request - delete resource
   */
  async handleDelete(
    match: RouteMatch,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const page = match.page
    const session = await this.getSession(request)

    try {
      // Check auth - Secure by default
      const authRequired = page.auth !== 'none' && page.auth !== 'optional'

      if (authRequired && !session) {
        // Log access denied
        this.auditLogger?.logAccessDenied(
          page.path,
          'delete',
          undefined,
          AuditLogger.extractContext(session, request)
        )

        reply.code(401).send({
          error: 'Authentication required',
          message: 'You must be logged in to perform this action'
        })
        return
      }

      if (!page.form || page.form.method !== 'delete') {
        reply.code(400).send({ error: 'No delete action defined for this page' })
        return
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
        this.auditLogger?.logAccessDenied(
          page.path,
          'delete',
          page.form.entity,
          AuditLogger.extractContext(session, request)
        )

        reply.code(403).send({
          error: 'Access denied',
          message: 'You do not have permission to delete this resource'
        })
        return
      }

      // Execute delete
      await this.executeFormAction(page.form, {}, {
        params: match.params,
        query: match.query,
        session,
      })

      // Log successful delete
      this.auditLogger?.logDataAccess(
        'delete',
        page.form.entity,
        match.params.id,
        session?.user?.id,
        true,
        AuditLogger.extractContext(session, request)
      )

      reply.send({
        success: true,
        message: 'Deleted successfully',
      })
    } catch (error) {
      // Sanitize error
      const sanitized = this.errorSanitizer?.sanitize(error) || {
        statusCode: 500,
        error: 'Delete failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }

      // Log failed delete
      this.auditLogger?.logDataAccess(
        'delete',
        page.form?.entity || 'unknown',
        match.params.id,
        session?.user?.id,
        false,
        {
          ...AuditLogger.extractContext(session, request),
          errorMessage: sanitized.message,
        }
      )

      reply.code(sanitized.statusCode).send(sanitized)
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async getSession(request: FastifyRequest): Promise<UserSession | null> {
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

  private async executeQuery(
    queryDef: Query,
    context: RouteContext
  ): Promise<any> {
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
    context: RouteContext
  ): Promise<any> {
    if (!this.queryExecutor) {
      throw new Error('No query executor available')
    }

    try {
      switch (form.method) {
        case 'create':
          return await this.queryExecutor.create(form.entity, data, context)

        case 'update':
          // Get ID from params or data
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

  private validateForm(form: Form, data: Record<string, any>): Array<{ field: string; message: string }> {
    const errors: Array<{ field: string; message: string }> = []

    for (const field of form.fields) {
      const value = data[field.name]

      // Required check (skip for file fields, handled separately below)
      if (field.type !== 'file' && field.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: field.name,
          message: `${field.label || field.name} is required`,
        })
      }

      // Pattern check
      if (field.pattern && value) {
        const regex = new RegExp(field.pattern)
        if (!regex.test(value)) {
          errors.push({
            field: field.name,
            message: field.error_message || 'Invalid format',
          })
        }
      }

      // Min/max checks for numbers
      if (field.type === 'number' && value !== undefined && value !== null) {
        if (field.min !== undefined && value < field.min) {
          errors.push({
            field: field.name,
            message: `Must be at least ${field.min}`,
          })
        }
        if (field.max !== undefined && value > field.max) {
          errors.push({
            field: field.name,
            message: `Must be at most ${field.max}`,
          })
        }
      }

      // File type validation
      if (field.type === 'file') {
        // Check if file was uploaded (for required fields)
        if (field.required && !value) {
          errors.push({
            field: field.name,
            message: `${field.label || field.name} is required`,
          })
        }

        // Size validation is handled in processMultipartForm
        // MIME type validation is handled in processMultipartForm
      }
    }

    return errors
  }

  private replacePlaceholders(
    template: string,
    values: Record<string, any>
  ): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      return values[key] !== undefined ? String(values[key]) : `{${key}}`
    })
  }

  /**
   * Check authorization for form actions (create, update, delete)
   */
  private async checkFormAuthorization(
    form: Form,
    action: 'create' | 'update' | 'delete',
    data: Record<string, any>,
    session: UserSession | null,
    recordId?: string
  ): Promise<boolean> {
    // Get entity from blueprint
    if (!this.blueprint?.entities) {
      return false
    }

    const entity = this.blueprint.entities.find((item: any) => item?.name === form.entity)
    if (!entity || typeof entity !== 'object') {
      // If entity not found, deny by default
      return false
    }

    // For update/delete, fetch existing record to check ownership
    if ((action === 'update' || action === 'delete') && recordId && this.queryExecutor) {
      try {
        const existingRecord = await this.queryExecutor.findById(
          form.entity,
          recordId
        )

        // Merge existing record with new data for update checks
        data = { ...existingRecord, ...data }
      } catch (error) {
        // If record not found or access denied, return false
        return false
      }
    }

    // Use AccessControl to check permissions
    const { AccessControl } = await import('../database/access-control.js')

    try {
      const hasAccess = await AccessControl.checkAccess({
        session,
        action,
        entity: entity as any,
        data,
        permissionManager: this.queryExecutor?.['permissionManager'],
      })

      return hasAccess
    } catch (error) {
      // On error, deny access
      console.error('Authorization check error:', error)
      return false
    }
  }

  /**
   * Process multipart form data (handles file uploads)
   */
  private async processMultipartForm(
    request: FastifyRequest,
    form: Form
  ): Promise<Record<string, any>> {
    const data: Record<string, any> = {}
    const parts = request.parts()

    for await (const part of parts) {
      if (part.type === 'file') {
        // Find field definition
        const field = form.fields.find(f => f.name === part.fieldname)

        if (!field || field.type !== 'file') {
          continue
        }

        // Validate file
        const validation = this.fileStorage.validateFile(part as MultipartFile, {
          maxSize: field.max || 50 * 1024 * 1024,
          allowedTypes: field.accept,
        })

        if (!validation.valid) {
          throw new Error(validation.error)
        }

        // Save file
        const uploadedFile = await this.fileStorage.saveFile(part as MultipartFile)

        // Store file URL/path in form data
        data[part.fieldname] = uploadedFile.url
        data[`${part.fieldname}_id`] = uploadedFile.id
        data[`${part.fieldname}_filename`] = uploadedFile.originalName
        data[`${part.fieldname}_size`] = uploadedFile.size
        data[`${part.fieldname}_mimetype`] = uploadedFile.mimeType
      } else {
        // Regular form field
        data[part.fieldname] = (part as any).value
      }
    }

    return data
  }

  /**
   * Check if form has file fields
   */
  private hasFileFields(form: Form): boolean {
    return form.fields.some(f => f.type === 'file')
  }
}
