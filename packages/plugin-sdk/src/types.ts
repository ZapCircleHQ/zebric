/**
 * Plugin SDK Types
 */

export interface Plugin {
  name: string
  version: string
  provides: PluginCapabilities
  requires?: PluginRequirements

  init?: (engine: EngineAPI, config: Record<string, any>) => Promise<void>

  workflows?: Record<string, WorkflowAction>
  components?: Record<string, any>
  integrations?: Record<string, any>
  middleware?: Record<string, MiddlewareHandler>
}

export interface PluginCapabilities {
  workflows?: string[]
  components?: string[]
  integrations?: string[]
  middleware?: string[]
  layouts?: string[]
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
  db: any
  auth: {
    getCurrentUser(request: any): Promise<any>
    createSession(userId: string): Promise<any>
    invalidateSession(sessionId: string): Promise<void>
  }
  storage: {
    upload(key: string, data: Buffer, options?: any): Promise<string>
    download(key: string): Promise<Buffer>
    delete(key: string): Promise<void>
    getUrl(key: string): string
  }
  cache: {
    get<T>(key: string): Promise<T | null>
    set(key: string, value: any, ttl?: number): Promise<void>
    delete(key: string): Promise<void>
    incr(key: string): Promise<number>
  }
  workflows: {
    trigger(name: string, context: any): Promise<void>
  }
  on(event: string, handler: Function): void
  emit(event: string, data: any): void
  blueprint: any
  log: {
    debug(message: string, meta?: any): void
    info(message: string, meta?: any): void
    warn(message: string, meta?: any): void
    error(message: string, meta?: any): void
  }
}
