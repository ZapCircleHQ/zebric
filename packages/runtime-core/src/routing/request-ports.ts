/**
 * Request Handler Ports
 *
 * Platform-agnostic interfaces for HTTP request handling.
 * Each platform (Node, Workers, etc.) provides concrete implementations.
 */

import type { UserSession } from '../auth/session.js'
import type { Query, Form } from '../types/blueprint.js'
import type { Actor } from '../auth/actor.js'
import type { CommandMutationAuthority } from '../commands/protection.js'

/**
 * Request context passed to handlers
 */
export interface RequestContext {
  params?: Record<string, string>
  query?: Record<string, string>
  body?: any
  session?: UserSession | null
  actor?: Actor
  /** Opaque authority issued only while the command pipeline is executing. */
  commandMutation?: CommandMutationAuthority
  source?: 'ui' | 'http' | 'mcp' | 'workflow' | 'internal'
  workflow?: string
  workflowContext?: Record<string, unknown>
  correlationId?: string
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
  readonly liveChanges?: import('../live/live.js').LiveChangeSource
  execute(query: Query, context: RequestContext): Promise<any>
  create(entity: string, data: Record<string, any>, context: RequestContext): Promise<any>
  update(entity: string, id: string, data: Record<string, any>, context: RequestContext): Promise<any>
  delete(entity: string, id: string, context: RequestContext): Promise<any>
  findById(entity: string, id: string, context?: { session?: UserSession | null }): Promise<any>
  /**
   * OR-across-fields substring search. Used by the lookup control's search
   * endpoint. Respects entity read access rules. Returns camelCase records.
   */
  search(
    entity: string,
    fields: string[],
    query: string,
    options?: {
      limit?: number
      filter?: Record<string, any>
      context?: RequestContext
    }
  ): Promise<any[]>
  /** Run command state changes atomically where the adapter supports transactions. */
  transaction?<T>(fn: () => Promise<T>): Promise<T>
  /** Run an effect after the outermost active transaction commits, or immediately when none is active. */
  afterCommit?(effect: () => Promise<void> | void): Promise<void> | void
}

/**
 * Session manager port - manages user sessions
 */
export interface SessionManagerPort {
  /** Accept any request-like object — concrete platforms may pass Fetch Request or HttpRequest. */
  getSession(request: HttpRequest | Request): Promise<UserSession | null>
}

/**
 * Renderer port - renders HTML pages
 */
export interface RendererPort {
  renderPage(context: RenderContext): string
}

export interface CommandAvailabilityPort {
  list(request: {
    entity: string
    record: Record<string, unknown>
    session?: UserSession | null
  }): Promise<string[]>
}

export interface FlashMessage {
  type: 'success' | 'error' | 'info' | 'warning'
  text: string
}

export interface RenderContext {
  pagination?: import('../renderer/table-pagination.js').TablePagination
  liveCursor?: string
  page: any // Page type
  data: Record<string, any>
  params: Record<string, string>
  query: Record<string, string>
  session?: UserSession | null
  csrfToken?: string
  renderer?: RendererContext
  flash?: FlashMessage
  /** Command names already authorized and available for this actor/record. */
  availableCommands?: string[]
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
  flash?: FlashMessage
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
}

export interface LogEvent {
  auditId?: string
  eventType: string
  severity: string
  action: string
  resource: string
  success: boolean
  userId?: string
  ipAddress?: string
  userAgent?: string
  entityType?: string
  entityId?: string
  metadata?: Record<string, any>
  correlationId?: string
  requestId?: string
  actorType?: Actor['type']
  actorId?: string
  workflowName?: string
  actionName?: string
}

/** Application services consumed by the platform-neutral request handler. */
export interface RuntimePorts {
  liveChanges?: import('../live/live.js').LiveChangeSource
  queryExecutor?: QueryExecutorPort
  sessionManager?: SessionManagerPort
  renderer?: RendererPort
  auditLogger?: AuditLoggerPort
  eventPublisher?: DomainEventPublisherPort
  /** Persists command audit and events inside the mutation's transaction. */
  commandEffects?: CommandEffectsPort
  executionObserver?: ExecutionObserverPort
  services?: import('../services/registry.js').ServiceInvoker
  commandAvailability?: CommandAvailabilityPort
}

export interface ExecutionObserverPort {
  startSpan(
    name: 'zebric.command' | 'zebric.policy' | 'zebric.workflow' | 'zebric.workflow.step' | 'zebric.service',
    attributes: Record<string, string | number | boolean | undefined>,
    correlationId?: string,
  ): unknown
  endSpan(handle: unknown, error?: unknown): void
}

export interface DomainEventPublisherPort {
  publish(event: DomainCommandEvent): void | Promise<void>
}

export interface DomainCommandEvent {
  name: string
  entity: string
  recordId: string
  command: string
  actor: Actor
  data?: Record<string, unknown>
  occurredAt: string
  correlationId?: string
}

export interface CommandEffectsPort {
  enqueue(effects: { audit: LogEvent[]; events: DomainCommandEvent[] }): Promise<void>
}
