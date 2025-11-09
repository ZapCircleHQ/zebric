/**
 * Mock CloudFlare Workers types for testing
 * Using 'any' to avoid complex type issues in test mocks
 */

export class MockD1Database {
  private data: Map<string, any[]> = new Map()

  prepare(query: string): any {
    return new MockD1PreparedStatement(query, this.data)
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('Not implemented in mock')
  }

  async batch<T = unknown>(statements: any[]): Promise<any[]> {
    const results: any[] = []
    for (const stmt of statements) {
      results.push(await stmt.run())
    }
    return results
  }

  async exec(query: string): Promise<any> {
    // Simple exec implementation for schema creation
    const queries = query.split(';').filter(q => q.trim())
    for (const q of queries) {
      const trimmed = q.trim().toLowerCase()
      if (trimmed.startsWith('create table')) {
        // Extract table name and column definitions
        const match = q.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([^)]+)\)/i)
        if (match) {
          const tableName = match[1].toLowerCase()
          const columnDefs = match[2]

          if (!this.data.has(tableName)) {
            // Store table schema as metadata
            const columns = columnDefs.split(',').map(col => {
              const colMatch = col.trim().match(/^(\w+)/)
              return colMatch ? colMatch[1] : null
            }).filter(Boolean)

            // Store schema in a special metadata entry
            this.data.set(`__schema_${tableName}`, columns as any)
            // Initialize empty table
            this.data.set(tableName, [])
          }
        }
      }
    }
    return {
      count: queries.length,
      duration: 0
    }
  }
}

class MockD1PreparedStatement {
  private params: unknown[] = []

  constructor(
    private query: string,
    private data: Map<string, any[]>
  ) {}

  bind(...values: unknown[]): any {
    this.params = values
    return this
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const result = await this.all<T>()
    if (result.results.length === 0) return null
    if (colName) {
      return (result.results[0] as any)[colName] ?? null
    }
    return result.results[0]
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const query = this.query.toLowerCase().trim()

    if (query.startsWith('insert')) {
      return this.handleInsert()
    } else if (query.startsWith('update')) {
      return this.handleUpdate()
    } else if (query.startsWith('delete')) {
      return this.handleDelete()
    } else if (query.startsWith('select')) {
      return this.all<T>()
    }

    return {
      success: true,
      meta: {} as any,
      results: [] as T[]
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const query = this.query.toLowerCase().trim()

    if (query.startsWith('select')) {
      return this.handleSelect<T>()
    } else if (query.startsWith('insert')) {
      return this.handleInsert()
    } else if (query.startsWith('update')) {
      return this.handleUpdate()
    } else if (query.startsWith('delete')) {
      return this.handleDelete()
    }

    return {
      success: true,
      meta: {} as any,
      results: [] as T[]
    }
  }

  async raw<T = unknown>(): Promise<T[]> {
    const result = await this.all<T>()
    return result.results || []
  }

  private handleInsert(): any {
    const tableMatch = this.query.match(/insert\s+into\s+(\w+)/i)
    if (!tableMatch) {
      return { success: false, error: 'Invalid INSERT query', results: [], meta: {} as any }
    }

    const tableName = tableMatch[1].toLowerCase()
    const table = this.data.get(tableName) || []

    // Extract column names from query - handle both formats:
    // INSERT INTO table (col1, col2) VALUES (?, ?)
    // INSERT INTO table VALUES (?, ?)
    const colMatch = this.query.match(/insert\s+into\s+\w+\s*\(([^)]+)\)\s*values/i)
    const row: any = {}

    if (colMatch) {
      // Explicit column names
      const columns = colMatch[1].split(',').map(c => c.trim())
      columns.forEach((col, idx) => {
        if (idx < this.params.length) {
          row[col] = this.params[idx]
        }
      })
    } else {
      // No column names - try to infer from schema or existing table structure
      const schema = this.data.get(`__schema_${tableName}`)

      if (schema && Array.isArray(schema)) {
        // Use schema
        schema.forEach((col: string, idx: number) => {
          if (idx < this.params.length) {
            row[col] = this.params[idx]
          }
        })
      } else if (table.length > 0) {
        // Use existing table structure
        const existingColumns = Object.keys(table[0])
        existingColumns.forEach((col, idx) => {
          if (idx < this.params.length) {
            row[col] = this.params[idx]
          }
        })
      } else {
        // Fallback to generic column names
        this.params.forEach((val, idx) => {
          row[`col${idx}`] = val
        })
      }
    }

    table.push(row)
    this.data.set(tableName, table)

    return {
      success: true,
      meta: {
        changed_db: true,
        changes: 1,
        last_row_id: table.length,
        rows_read: 0,
        rows_written: 1
      } as any,
      results: []
    }
  }

  private handleUpdate(): any {
    return {
      success: true,
      meta: {
        changed_db: true,
        changes: 1,
        rows_written: 1
      },
      results: []
    }
  }

  private handleDelete(): any {
    return {
      success: true,
      meta: {
        changed_db: true,
        changes: 1,
        rows_written: 1
      },
      results: []
    }
  }

  private handleSelect<T>(): any {
    // Handle simple SELECT 1 health check queries
    if (this.query.match(/select\s+\d+/i) && !this.query.includes('from')) {
      return {
        success: true,
        results: [{ '1': 1 }] as T[],
        meta: {
          rows_read: 1,
          rows_written: 0
        } as any
      }
    }

    const match = this.query.match(/from\s+(\w+)/i)
    if (!match) {
      return { success: true, results: [] as T[], meta: {} as any }
    }

    const tableName = match[1].toLowerCase()
    let table = this.data.get(tableName) || []

    // Simple WHERE clause handling for tests
    if (this.query.includes('where') && this.params.length > 0) {
      const whereMatch = this.query.match(/where\s+(\w+)\s*=\s*\?/i)
      if (whereMatch) {
        const column = whereMatch[1]
        const value = this.params[0]
        table = table.filter((row: any) => row[column] === value)
      }
    }

    return {
      success: true,
      results: table as T[],
      meta: {
        rows_read: table.length,
        rows_written: 0
      } as any
    }
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
