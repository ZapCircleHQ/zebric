/**
 * Request Handler Ports
 *
 * Platform-agnostic interfaces for HTTP request handling.
 * Each platform (Node, Workers, etc.) provides concrete implementations.
 */

import type { UserSession } from '../auth/session.js'
import type { Query, Form } from '../types/blueprint.js'

/**
 * Request context passed to handlers
 */
export interface RequestContext {
  params: Record<string, string>
  query: Record<string, string>
  body?: any
  session?: UserSession | null
}

/**
 * Generic HTTP request interface
 */
export interface HttpRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body?: any
}

/**
 * Generic HTTP response interface
 */
export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string | ArrayBuffer | ReadableStream
}

/**
 * Query executor port - executes data queries
 */
export interface QueryExecutorPort {
  execute(query: Query, context: RequestContext): Promise<any>
  create(entity: string, data: Record<string, any>, context: RequestContext): Promise<any>
  update(entity: string, id: string, data: Record<string, any>, context: RequestContext): Promise<any>
  delete(entity: string, id: string, context: RequestContext): Promise<any>
  findById(entity: string, id: string): Promise<any>
}

/**
 * Session manager port - manages user sessions
 */
export interface SessionManagerPort {
  getSession(request: HttpRequest): Promise<UserSession | null>
}

/**
 * Renderer port - renders HTML pages
 */
export interface RendererPort {
  renderPage(context: RenderContext): string
}

export interface RenderContext {
  page: any // Page type
  data: Record<string, any>
  params: Record<string, string>
  query: Record<string, string>
  session?: UserSession | null
  csrfToken?: string
  renderer?: RendererContext
}

/**
 * Extended renderer context available in templates
 */
export interface RendererContext {
  theme?: any
  segments?: Record<string, string>
  slot?: SlotContext
  feedback?: string
  fields?: Record<string, string>
  script?: string
  content?: string
  [key: string]: unknown
}

// ============================================================================
// Layout Slot Contexts
// ============================================================================

/**
 * Base slot context available to all slots
 */
export interface BaseSlotContext {
  theme?: any
  entity?: any
}

/**
 * Context available to list.header slot
 */
export interface ListHeaderSlotContext extends BaseSlotContext {
  entity?: any
}

/**
 * Context available to list.empty slot
 */
export interface ListEmptySlotContext extends BaseSlotContext {
  entity?: any
}

/**
 * Context available to list.body slot
 */
export interface ListBodySlotContext extends BaseSlotContext {
  entity?: any
  items: any[]
}

/**
 * Context available to detail.main slot
 */
export interface DetailMainSlotContext extends BaseSlotContext {
  record: any
  entity?: any
}

/**
 * Context available to detail.related slot
 */
export interface DetailRelatedSlotContext extends BaseSlotContext {
  entity?: any
  data: Record<string, any>
}

/**
 * Context available to form.form slot
 */
export interface FormFormSlotContext extends BaseSlotContext {
  form: Form
  record?: any
}

/**
 * Context available to dashboard.widgets slot
 */
export interface DashboardWidgetsSlotContext extends BaseSlotContext {
  widgets: any[] // Array of rendered widget SafeHtml
  data: Record<string, any>
}

/**
 * Union type for all slot contexts
 */
export type SlotContext =
  | ListHeaderSlotContext
  | ListEmptySlotContext
  | ListBodySlotContext
  | DetailMainSlotContext
  | DetailRelatedSlotContext
  | FormFormSlotContext
  | DashboardWidgetsSlotContext

/**
 * Audit logger port - logs security events
 */
export interface AuditLoggerPort {
  log(event: LogEvent): void
  logAccessDenied(resource: string, action: string, entity?: string, context?: any): void
  logDataAccess(action: string, entity: string, recordId?: string, userId?: string, success?: boolean, context?: any): void
}

export interface LogEvent {
  eventType: string
  severity: string
  action: string
  resource: string
  success: boolean
  userId?: string
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, any>
}

/**
 * File upload result
 */
export interface UploadedFile {
  id: string
  url: string
  originalName: string
  size: number
  mimeType: string
}

/**
 * File storage port - handles file uploads
 */
export interface FileStoragePort {
  validateFile(file: any, options: FileValidationOptions): { valid: boolean; error?: string }
  saveFile(file: any): Promise<UploadedFile>
}

export interface FileValidationOptions {
  maxSize?: number
  allowedTypes?: string[]
}

/**
 * Authorization checker port
 */
export interface AuthorizationPort {
  checkAccess(options: AccessCheckOptions): Promise<boolean>
}

export interface AccessCheckOptions {
  session: UserSession | null
  action: 'create' | 'read' | 'update' | 'delete'
  entity: any
  data?: Record<string, any>
  recordId?: string
}
