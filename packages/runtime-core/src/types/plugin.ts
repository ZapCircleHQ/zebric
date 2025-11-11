/**
 * Plugin Types
 *
 * Types for the plugin system.
 */

import type { Blueprint, Page, Entity, Field as BlueprintField } from './blueprint.js'
import type { UserSession } from '../auth/index.js'
import type { Theme } from '../renderer/theme.js'

export interface Plugin {
  name: string
  version: string
  description?: string
  provides: PluginCapabilities
  requires?: PluginRequirements

  init?: (engine: EngineAPI, config: Record<string, any>) => Promise<void>

  // Plugin capabilities
  workflows?: Record<string, WorkflowAction>
  layouts?: Record<string, LayoutRenderer>
  fieldValidators?: Record<string, FieldValidator>
  actionHandlers?: Record<string, ActionHandler>
  components?: Record<string, any>
  integrations?: Record<string, any>
  middleware?: Record<string, MiddlewareHandler>
}

export interface PluginCapabilities {
  workflows?: string[]
  layouts?: string[]
  fieldValidators?: string[]
  actionHandlers?: string[]
  components?: string[]
  integrations?: string[]
  middleware?: string[]
}

export interface PluginRequirements {
  db?: boolean
  auth?: boolean
  storage?: boolean
  cache?: boolean
}

export type WorkflowAction = (
  params: Record<string, any>,
  context: WorkflowContext
) => Promise<void>

export type MiddlewareHandler = (
  request: any,
  reply: any,
  engine: EngineAPI
) => Promise<void>

export interface WorkflowContext {
  db: any
  auth: any
  storage: any
  cache: any
  log: any
}

export interface EngineAPI {
  // Database access
  db: any

  // Auth
  auth: {
    getCurrentUser(request: any): Promise<any>
    createSession(userId: string, options?: { replaceToken?: string }): Promise<PluginAuthToken>
    invalidateSession(token: string): Promise<void>
  }

  // Storage
  storage: {
    upload(key: string, data: ArrayBuffer | Uint8Array, options?: any): Promise<string>
    download(key: string): Promise<ArrayBuffer>
    delete(key: string): Promise<void>
    getUrl(key: string): string
  }

  // Cache
  cache: {
    get<T>(key: string): Promise<T | null>
    set(key: string, value: any, ttl?: number): Promise<void>
    delete(key: string): Promise<void>
    incr(key: string): Promise<number>
    exists(key: string): Promise<boolean>
    clear(): Promise<void>
  }

  // Workflows
  workflows: {
    trigger(name: string, context: any): Promise<void>
  }

  // Events
  on(event: string, handler: Function): void
  emit(event: string, data: any): void

  // Blueprint (read-only)
  blueprint: Readonly<Blueprint>

  // Logging
  log: {
    debug(message: string, meta?: any): void
    info(message: string, meta?: any): void
    warn(message: string, meta?: any): void
    error(message: string, meta?: any): void
  }
}

export interface PluginAuthToken {
  id: string
  userId: string
  token: string
  createdAt: Date
  expiresAt: Date
}

export interface LoadedPlugin {
  definition: any
  module: any
  plugin: Plugin
}

/**
 * Layout Renderer
 *
 * Renders custom page layouts. Receives page data and theme,
 * returns HTML string.
 */
export interface LayoutRendererContext {
  page: Page
  data: Record<string, any>
  params: Record<string, string>
  query: Record<string, string>
  session: UserSession | null
  theme: Theme
}

export type LayoutRenderer = (context: LayoutRendererContext) => string | Promise<string>

/**
 * Field Validator
 *
 * Validates field values with custom logic.
 * Returns error message string if validation fails, undefined if passes.
 */
export interface FieldValidatorContext {
  field: BlueprintField
  value: any
  data: Record<string, any> // All form data
  entity: Entity
  session: UserSession | null
}

export type FieldValidator = (context: FieldValidatorContext) => string | undefined | Promise<string | undefined>

/**
 * Action Handler
 *
 * Handles custom form actions or API endpoints.
 * Returns result data or throws error.
 */
export interface ActionHandlerContext {
  action: string
  data: Record<string, any>
  params: Record<string, string>
  query: Record<string, string>
  session: UserSession | null
  engine: EngineAPI
}

export type ActionHandler = (context: ActionHandlerContext) => any | Promise<any>
