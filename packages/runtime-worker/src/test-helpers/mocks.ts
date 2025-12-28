/**
 * Mock CloudFlare Workers types for testing
 * Uses better-sqlite3 under the hood to approximate D1 behavior.
 */

import Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'

export class MockD1Database {
  private db: Database.Database

  constructor() {
    this.db = new Database(':memory:')
    // Enable foreign keys / WAL to match D1 defaults as closely as possible
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
  }

  prepare(query: string): any {
    return new MockD1PreparedStatement(this.db.prepare(query))
  }

  async dump(): Promise<ArrayBuffer> {
    const buffer = this.db.serialize()
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    return arrayBuffer as ArrayBuffer
  }

  async batch<T = unknown>(statements: any[]): Promise<any[]> {
    const results: any[] = []
    for (const stmt of statements) {
      results.push(await stmt.run())
    }
    return results
  }

  async exec(query: string): Promise<any> {
    this.db.exec(query)
    const statements = query.split(';').filter(q => q.trim())
    return {
      count: statements.length,
      duration: 0
    }
  }
}

class MockD1PreparedStatement {
  private params: unknown[] = []

  constructor(private stmt: Statement) {}

  bind(...values: unknown[]): any {
    this.params = values
    return this
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    try {
      const row = this.stmt.get(...this.params) as T | undefined
      if (!row) return null
      if (colName && typeof row === 'object' && row !== null) {
        return (row as any)[colName] ?? null
      }
      return row
    } catch {
      return null
    }
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    try {
      const info = this.stmt.run(...this.params)
      return {
        success: true,
        results: [] as T[],
        meta: {
          rows_read: 0,
          rows_written: info.changes,
          changed_db: info.changes > 0,
          last_row_id: Number(info.lastInsertRowid),
          changes: info.changes,
          duration: 0,
          size_after: 0
        }
      }
    } catch (error) {
      throw error
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    try {
      const stmtReader = (this.stmt as any).reader as boolean | undefined
      if (stmtReader) {
        const rows = this.stmt.all(...this.params) as T[]
        return {
          success: true,
          results: rows,
          meta: {
            rows_read: rows.length,
            rows_written: 0,
            changed_db: false,
            last_row_id: Number((this.stmt as any).lastInsertRowid ?? 0),
            changes: 0,
            duration: 0,
            size_after: 0
          }
        }
      }

      const info = this.stmt.run(...this.params)
      return {
        success: true,
        results: [] as T[],
        meta: {
          rows_read: 0,
          rows_written: info.changes,
          changed_db: info.changes > 0,
          last_row_id: Number(info.lastInsertRowid),
          changes: info.changes,
          duration: 0,
          size_after: 0
        }
      }
    } catch (error) {
      throw error
    }
  }

  async raw<T = unknown>(): Promise<T[]> {
    const result = await this.all<T>()
    return result.results || []
  }
}

export class MockKVNamespace  {
  private data: Map<string, { value: string; metadata?: any; expiration?: number }> = new Map()

  async get(key: string, options?: { type: 'text' }): Promise<string | null>
  async get(key: string, options: { type: 'json' }): Promise<any>
  async get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>
  async get(key: string, options: { type: 'stream' }): Promise<ReadableStream | null>
  async get(key: string, options?: any): Promise<any> {
    const entry = this.data.get(key)
    if (!entry) return null

    // Check expiration
    if (entry.expiration && Date.now() > entry.expiration) {
      this.data.delete(key)
      return null
    }

    const type = options?.type || 'text'

    if (type === 'json') {
      return JSON.parse(entry.value)
    } else if (type === 'arrayBuffer') {
      return new TextEncoder().encode(entry.value).buffer
    } else if (type === 'stream') {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(entry.value))
          controller.close()
        }
      })
    }

    return entry.value
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: any): Promise<void> {
    let stringValue: string

    if (typeof value === 'string') {
      stringValue = value
    } else if (value instanceof ArrayBuffer) {
      stringValue = new TextDecoder().decode(value)
    } else if (ArrayBuffer.isView(value)) {
      stringValue = new TextDecoder().decode(value)
    } else {
      // ReadableStream - simplified for testing
      stringValue = '[stream]'
    }

    const entry: any = { value: stringValue }

    if (options?.metadata) {
      entry.metadata = options.metadata
    }

    if (options?.expirationTtl) {
      entry.expiration = Date.now() + (options.expirationTtl * 1000)
    } else if (options?.expiration) {
      entry.expiration = options.expiration * 1000
    }

    this.data.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  async list(options?: any): Promise<KVNamespaceListResult<any, string>> {
    const keys = Array.from(this.data.keys())
    const prefix = options?.prefix || ''

    const filtered = keys
      .filter(k => k.startsWith(prefix))
      .map(name => ({ name }))

    return {
      keys: filtered,
      list_complete: true,
      cacheStatus: null
    }
  }

  async getWithMetadata<Metadata = unknown>(key: string, options?: any): Promise<{ value: any; metadata: Metadata | null }> {
    const entry = this.data.get(key)
    if (!entry) return { value: null, metadata: null }

    const value = await this.get(key, options)
    return {
      value,
      metadata: (entry.metadata as Metadata) || null
    }
  }
}

export class MockR2Bucket  {
  private data: Map<string, { body: ArrayBuffer; metadata?: any; customMetadata?: Record<string, string>; httpMetadata?: R2HTTPMetadata }> = new Map()

  async head(key: string): Promise<R2Object | null> {
    const entry = this.data.get(key)
    if (!entry) return null

    return {
      key,
      version: '1',
      size: entry.body.byteLength,
      etag: 'mock-etag',
      httpEtag: 'mock-etag',
      checksums: {},
      uploaded: new Date(),
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
      range: undefined,
      writeHttpMetadata: (headers: Headers) => {}
    } as R2Object
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.data.get(key)
    if (!entry) return null

    const obj: any = await this.head(key)
    obj.body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(entry.body))
        controller.close()
      }
    })
    obj.bodyUsed = false
    obj.arrayBuffer = async () => entry.body
    obj.text = async () => new TextDecoder().decode(entry.body)
    obj.json = async () => JSON.parse(new TextDecoder().decode(entry.body))
    obj.blob = async () => new Blob([entry.body])

    return obj as R2ObjectBody
  }

  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object> {
    let buffer: ArrayBuffer

    if (typeof value === 'string') {
      buffer = new TextEncoder().encode(value).buffer
    } else if (value instanceof ArrayBuffer) {
      buffer = value
    } else if (ArrayBuffer.isView(value)) {
      buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
    } else if (value instanceof Blob) {
      buffer = await value.arrayBuffer()
    } else if (value instanceof ReadableStream) {
      // Simplified stream handling
      buffer = new ArrayBuffer(0)
    } else {
      buffer = new ArrayBuffer(0)
    }

    this.data.set(key, {
      body: buffer,
      httpMetadata: options?.httpMetadata as any,
      customMetadata: options?.customMetadata
    })

    return (await this.head(key))!
  }

  async delete(keys: string | string[]): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    keyArray.forEach(key => this.data.delete(key))
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const keys = Array.from(this.data.keys())
    const prefix = options?.prefix || ''

    const objects = await Promise.all(
      keys
        .filter(k => k.startsWith(prefix))
        .map(async k => await this.head(k))
    )

    return {
      objects: objects.filter((o): o is R2Object => o !== null),
      truncated: false,
      delimitedPrefixes: []
    }
  }

  async createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload> {
    throw new Error('Multipart upload not implemented in mock')
  }

  async resumeMultipartUpload(key: string, uploadId: string): Promise<R2MultipartUpload> {
    throw new Error('Multipart upload not implemented in mock')
  }
}
