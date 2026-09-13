/**
 * Platform service ports.
 *
 * Application-facing request ports are defined in routing/request-ports and
 * re-exported here. The interfaces below describe infrastructure contracts
 * with active runtime implementations.
 */

export type {
  AuditLoggerPort,
  HttpRequest,
  HttpResponse,
  QueryExecutorPort,
  RendererPort,
  RequestContext,
  RuntimePorts,
  SessionManagerPort,
} from './routing/request-ports.js'
export type { CachePort } from './cache/cache-interface.js'

/** Low-level SQL service used by adapters such as Cloudflare D1. */
export interface SqlStoragePort {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  transaction<T>(fn: (tx: SqlStoragePort) => Promise<T>): Promise<T>
  migrate(statements: string[]): Promise<void>
  healthCheck(): Promise<boolean>
  close(): Promise<void>
}

export interface ObjectMetadata {
  key: string
  size: number
  contentType?: string
  uploaded: Date
  metadata?: Record<string, unknown>
}

/** Low-level binary object storage used by adapters such as Cloudflare R2. */
export interface ObjectStoragePort {
  get(key: string): Promise<ReadableStream | null>
  put(
    key: string,
    body: ReadableStream | ArrayBuffer | Uint8Array | string,
    options?: { contentType?: string; metadata?: Record<string, unknown> },
  ): Promise<void>
  delete(key: string): Promise<void>
  list?(prefix?: string): Promise<ObjectMetadata[]>
  head?(key: string): Promise<ObjectMetadata | null>
}

/** Request/Response translation implemented by an HTTP runtime package. */
export interface HttpRequestAdapter {
  handle(request: Request): Promise<Response>
}
