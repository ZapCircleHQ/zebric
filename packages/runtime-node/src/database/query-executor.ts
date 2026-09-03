/**
 * Query Executor
 *
 * Executes Blueprint queries using Drizzle ORM.
 * Translates Blueprint query syntax to SQL.
 */

import { eq, and, or, gt, gte, lt, lte, like, ilike, asc, desc, sql, SQL } from 'drizzle-orm'
import type { Query, Entity } from '@zebric/runtime-core'
import type { DatabaseConnection } from './connection.js'
import type { UserSession, PermissionManager } from '@zebric/runtime-core'
import { AccessControl, isSystemSession } from '@zebric/runtime-core'
import { ulid } from 'ulid'
import { MetricsRegistry } from '../monitoring/metrics.js'
import { AsyncLocalStorage } from 'node:async_hooks'
// performance.now() is available as a Web API (no import needed)

export interface QueryContext {
  params?: Record<string, string>
  query?: Record<string, string>
  session?: UserSession | null
}

export interface AuditOutboxRecord {
  id: string
  topic: string
  payload: string
  createdAt: number
}

export class QueryExecutor {
  private permissionManager?: PermissionManager
  private readonly transactionContext = new AsyncLocalStorage<{ token: symbol; db?: any }>()
  private activeTransaction?: { token: symbol; done: Promise<void> }
  private transactionTail: Promise<void> = Promise.resolve()

  constructor(
    private connection: DatabaseConnection,
    permissionManager?: PermissionManager,
    private metrics?: MetricsRegistry
  ) {
    this.permissionManager = permissionManager
  }

  /**
   * Execute a group of query operations as one database transaction.
   * Calls made through this executor from other async contexts wait until the
   * transaction completes, preventing them from joining a SQLite transaction.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Nested callers participate in the existing transaction.
    if (this.transactionContext.getStore()) {
      return fn()
    }
    await this.waitForTransaction()

    let releaseQueue!: () => void
    const previous = this.transactionTail
    this.transactionTail = new Promise<void>((resolve) => { releaseQueue = resolve })
    await previous

    const token = Symbol('query-transaction')
    let resolveDone!: () => void
    const done = new Promise<void>((resolve) => { resolveDone = resolve })
    this.activeTransaction = { token, done }

    try {
      const db = this.connection.getDb() as any
      if (this.connection.getType() === 'postgres') {
        return await db.transaction((tx: any) =>
          this.transactionContext.run({ token, db: tx }, fn)
        )
      }

      const sqlite = this.connection.getSQLite()
      if (!sqlite) throw new Error('SQLite connection is not initialized')
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const result = await this.transactionContext.run({ token }, fn)
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    } finally {
      this.activeTransaction = undefined
      resolveDone()
      releaseQueue()
    }
  }

  private getDb(): any {
    return this.transactionContext.getStore()?.db ?? this.connection.getDb()
  }

  private async waitForTransaction(): Promise<void> {
    const active = this.activeTransaction
    if (active && this.transactionContext.getStore()?.token !== active.token) {
      await active.done
    }
  }

  /** Persist an audit intent in the caller's active database transaction. */
  async enqueueAuditOutbox(record: AuditOutboxRecord): Promise<void> {
    await this.waitForTransaction()
    if (!this.transactionContext.getStore()) {
      throw new Error('Audit outbox entries must be enqueued inside a database transaction')
    }
    const db = this.getDb() as any
    const statement = sql`INSERT INTO __zbl_audit_outbox (id, topic, payload, created_at) VALUES (${record.id}, ${record.topic}, ${record.payload}, ${record.createdAt})`
    if (this.connection.getType() === 'postgres') await db.execute(statement)
    else db.run(statement)
  }

  /** Return undelivered audit intents without mutating them. */
  async listPendingAuditOutbox(limit = 100): Promise<AuditOutboxRecord[]> {
    await this.waitForTransaction()
    const db = this.getDb() as any
    const statement = sql`SELECT id, topic, payload, created_at FROM __zbl_audit_outbox WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT ${limit}`
    const result = this.connection.getType() === 'postgres'
      ? await db.execute(statement)
      : db.all(statement)
    const rows = Array.isArray(result) ? result : result?.rows ?? []
    return rows.map((row: any) => ({
      id: row.id,
      topic: row.topic,
      payload: row.payload,
      createdAt: Number(row.created_at),
    }))
  }

  async markAuditOutboxDelivered(id: string): Promise<void> {
    await this.waitForTransaction()
    const db = this.getDb() as any
    const statement = sql`UPDATE __zbl_audit_outbox SET delivered_at = ${Date.now()} WHERE id = ${id} AND delivered_at IS NULL`
    if (this.connection.getType() === 'postgres') await db.execute(statement)
    else db.run(statement)
  }

  /**
   * Set permission manager (for runtime updates)
   */
  setPermissionManager(permissionManager: PermissionManager): void {
    this.permissionManager = permissionManager
  }

  /**
   * Execute a Blueprint query
   */
  async execute(queryDef: Query, context: QueryContext = {}): Promise<any[]> {
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(queryDef.entity)
    const entity = this.connection.getEntity(queryDef.entity)

    if (!table) {
      throw new Error(`Entity ${queryDef.entity} not found`)
    }

    // Check read access
    if (entity) {
      const hasAccess = await AccessControl.checkAccess({
        session: context.session,
        action: 'read',
        entity,
        permissionManager: this.permissionManager,
      })

      if (!hasAccess) {
        throw new Error(`Access denied: Cannot read ${queryDef.entity}`)
      }
    }

    // Build WHERE clause with access control filters
    const whereClause = this.buildWhere(queryDef.where, context, queryDef.entity)
    const accessFilters = entity ? AccessControl.getFilterConditions(entity, context.session) : null
    if (AccessControl.isImpossibleFilter(accessFilters)) {
      throw new Error(`Access denied: Cannot read ${queryDef.entity}`)
    }

    // Combine query filters with access control filters
    let finalWhere = whereClause
    if (accessFilters) {
      const accessWhere = this.buildWhere(accessFilters, context, queryDef.entity)
      if (accessWhere && whereClause) {
        finalWhere = and(whereClause, accessWhere)
      } else if (accessWhere) {
        finalWhere = accessWhere
      }
    }

    // Build query
    let query = (db as any).select().from(table)

    // Apply WHERE
    if (finalWhere) {
      query = query.where(finalWhere) as any
    }

    // Apply ORDER BY
    if (queryDef.orderBy) {
      const orderClauses = []
      for (const [field, direction] of Object.entries(queryDef.orderBy)) {
        const column = table[field]
        if (column) {
          orderClauses.push(
            direction === 'asc' ? asc(column) : desc(column)
          )
        }
      }
      if (orderClauses.length > 0) {
        query = query.orderBy(...orderClauses) as any
      }
    }

    // Apply LIMIT
    if (queryDef.limit) {
      query = query.limit(queryDef.limit) as any
    }

    // Apply OFFSET
    if (queryDef.offset) {
      query = query.offset(queryDef.offset) as any
    }

    const start = performance.now()
    try {
      const results = await query
      // Convert snake_case to camelCase for consistency with findById/create/update.
      return Array.isArray(results) ? results.map((r) => this.toCamelCase(r)) : results
    } finally {
      this.metrics?.recordQuery(queryDef.entity, 'read', performance.now() - start)
    }
  }

  /**
   * Search for records across multiple text fields using case-insensitive
   * substring matching. Used by the lookup control's /_widget/search endpoint.
   *
   * `fields` are camelCase field names as declared in the blueprint. They get
   * mapped to the table's snake_case columns via the Drizzle schema. Fields
   * that don't exist on the table are silently dropped — the blueprint's own
   * validation is the source of truth for what's addressable.
   */
  async search(
    entityName: string,
    fields: string[],
    query: string,
    options: { limit?: number; filter?: Record<string, any>; context?: QueryContext } = {}
  ): Promise<any[]> {
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    if (entity) {
      const hasAccess = await AccessControl.checkAccess({
        session: options.context?.session,
        action: 'read',
        entity,
        permissionManager: this.permissionManager,
      })
      if (!hasAccess) {
        throw new Error(`Access denied: Cannot read ${entityName}`)
      }
    }

    const trimmed = String(query ?? '').trim()
    if (!trimmed) return []

    const pattern = `%${trimmed.replace(/[%_]/g, (c) => '\\' + c)}%`

    // Resolve field names → Drizzle columns (via both camel and snake lookup).
    const columns = fields
      .map((f) => table[f] ?? table[this.toSnakeCaseString(f)])
      .filter((c) => c != null)

    if (columns.length === 0) return []

    const match = (column: any) => this.connection.getType() === 'postgres'
      ? ilike(column, pattern)
      : like(column, pattern)

    const orCondition = columns.length === 1
      ? match(columns[0])
      : or(...columns.map((c) => match(c)))

    // Apply optional equality filters and entity-level access filters.
    let where: any = orCondition
    if (options.filter) {
      const filterWhere = this.buildWhere(options.filter, options.context ?? {}, entityName)
      if (filterWhere) where = and(where, filterWhere)
    }
    const accessFilters = entity ? AccessControl.getFilterConditions(entity, options.context?.session) : null
    if (accessFilters) {
      const accessWhere = this.buildWhere(accessFilters, options.context ?? {}, entityName)
      if (accessWhere) where = and(where, accessWhere)
    }

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)

    const start = performance.now()
    try {
      const results = await (db as any)
        .select()
        .from(table)
        .where(where)
        .limit(limit)

      return Array.isArray(results) ? results.map((r) => this.toCamelCase(r)) : []
    } finally {
      this.metrics?.recordQuery(entityName, 'search', performance.now() - start)
    }
  }

  /**
   * Find a single record by ID
   */
  async findById(entityName: string, id: string, context: QueryContext = {}): Promise<any | null> {
    const results = await this.execute({
      entity: entityName,
      where: { id },
      limit: 1,
    }, context)
    const record = results[0] || null
    return record ? this.toCamelCase(record) : null
  }

  /**
   * Drop any fields the caller is not permitted to write, per the blueprint's
   * field-level `access.write` rules. Trusted system / workflow sessions bypass
   * this the same way they bypass entity-level access checks - background workflow
   * logic is authored by the blueprint, not supplied by an end user or agent.
   */
  private applyWriteFieldAccess(
    entity: Entity | undefined,
    data: Record<string, any>,
    session?: UserSession | null
  ): Record<string, any> {
    if (!entity || isSystemSession(session)) {
      return data
    }
    return AccessControl.filterFields(entity, 'write', data, session)
  }

  /**
   * Create a new record
   */
  async create(entityName: string, data: Record<string, any>, context?: QueryContext): Promise<any> {
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    // Strip fields the caller cannot write before any access or default handling.
    data = this.applyWriteFieldAccess(entity, data, context?.session)

    // Check create access
    if (entity) {
      const hasAccess = await AccessControl.checkAccess({
        session: context?.session,
        action: 'create',
        entity,
        data,
        permissionManager: this.permissionManager,
      })

      if (!hasAccess) {
        throw new Error(`Access denied: Cannot create ${entityName}`)
      }
    }

    // Generate ID if not provided
    if (!data.id) {
      data.id = ulid()
    }

    // Set timestamps
    const now = new Date()
    if (!data.createdAt && table.createdAt) {
      data.createdAt = now
    }
    if (!data.updatedAt && table.updatedAt) {
      data.updatedAt = now
    }

    // Auto-populate userId from session if the field exists and isn't set
    if (context?.session?.user?.id && !data.userId && table.userId) {
      data.userId = context.session.user.id
    }

    // Auto-populate any User reference fields from session
    if (context?.session?.user?.id && entity) {
      for (const field of entity.fields) {
        if (field.type === 'Ref' && field.ref === 'User.id' && !data[field.name]) {
          data[field.name] = context.session.user.id
        }
      }
    }

    // Convert camelCase to snake_case for database
    const dbData = this.toSnakeCase(this.normalizeEntityValues(entity, data))

    const start = performance.now()
    try {
      const inserted = await (db as any).insert(table).values(dbData).returning()
      const record = inserted?.[0]
      if (record) {
        return this.toCamelCase(record)
      }

      return await this.findById(entityName, data.id, context)
    } finally {
      this.metrics?.recordQuery(entityName, 'create', performance.now() - start)
    }
  }

  /**
   * Update a record
   */
  async update(
    entityName: string,
    id: string,
    data: Record<string, any>,
    context?: QueryContext
  ): Promise<any> {
    return this.updateWhere(entityName, id, {}, data, context)
  }

  /**
   * Atomically update a record only while its current values match `expected`.
   * Used by workflow state transitions to prevent concurrent claims.
   */
  async updateWhere(
    entityName: string,
    id: string,
    expected: Record<string, any>,
    data: Record<string, any>,
    context?: QueryContext
  ): Promise<any> {
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    // Fetch existing record first for access control check
    const existingRecord = await this.findById(entityName, id, context)
    if (!existingRecord) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

    // Strip fields the caller cannot write before merge / access / default handling.
    data = this.applyWriteFieldAccess(entity, data, context?.session)

    // Check update access with merged data (existing + new)
    // This allows access control rules to reference existing fields like authorId
    if (entity) {
      const mergedData = { ...existingRecord, ...data }
      const hasAccess = await AccessControl.checkAccess({
        session: context?.session,
        action: 'update',
        entity,
        data: mergedData,
        permissionManager: this.permissionManager,
      })

      if (!hasAccess) {
        throw new Error(`Access denied: Cannot update ${entityName}`)
      }
    }

    // Every supplied field was stripped as unwritable - nothing to persist.
    if (Object.keys(data).length === 0) {
      return existingRecord
    }

    // Update timestamp
    const now = new Date()
    if (table.updatedAt) {
      data.updatedAt = now
    }

    // Convert camelCase to snake_case
    const dbData = this.toSnakeCase(this.normalizeEntityValues(entity, data))

    const start = performance.now()
    try {
      // Update record
      const expectedWhere = this.buildWhere(expected, context ?? {}, entityName)
      const whereClause = expectedWhere ? and(eq(table.id, id), expectedWhere) : eq(table.id, id)
      const updated = await (db as any)
        .update(table)
        .set(dbData)
        .where(whereClause)
        .returning()

      if (!updated?.[0]) {
        throw new Error(`Conflict: ${entityName} ${id} no longer matches the expected state`)
      }

      // Return updated record
      return this.toCamelCase(updated[0])
    } finally {
      this.metrics?.recordQuery(entityName, 'update', performance.now() - start)
    }
  }

  /**
   * Delete a record
   */
  async delete(entityName: string, id: string, context?: QueryContext): Promise<void> {
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    const existingRecord = await this.findById(entityName, id, context)
    if (!existingRecord) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

    // Check delete access
    if (entity) {
      const hasAccess = await AccessControl.checkAccess({
        session: context?.session,
        action: 'delete',
        entity,
        data: existingRecord,
        permissionManager: this.permissionManager,
      })

      if (!hasAccess) {
        throw new Error(`Access denied: Cannot delete ${entityName}`)
      }
    }

    const start = performance.now()
    try {
      await (db as any)
        .delete(table)
        .where(eq(table.id, id))
    } finally {
      this.metrics?.recordQuery(entityName, 'delete', performance.now() - start)
    }
  }

  /**
   * Count records matching query
   */
  async count(queryDef: Query, context: QueryContext = {}): Promise<number> {
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(queryDef.entity)

    if (!table) {
      throw new Error(`Entity ${queryDef.entity} not found`)
    }

    const entity = this.connection.getEntity(queryDef.entity)
    if (entity) {
      const hasAccess = await AccessControl.checkAccess({
        session: context.session,
        action: 'read',
        entity,
        permissionManager: this.permissionManager,
      })
      if (!hasAccess) {
        throw new Error(`Access denied: Cannot read ${queryDef.entity}`)
      }
    }

    const whereClause = this.buildWhere(queryDef.where, context, queryDef.entity)
    const accessFilters = entity ? AccessControl.getFilterConditions(entity, context.session) : null
    if (AccessControl.isImpossibleFilter(accessFilters)) {
      throw new Error(`Access denied: Cannot read ${queryDef.entity}`)
    }
    const accessWhere = accessFilters ? this.buildWhere(accessFilters, context, queryDef.entity) : undefined
    const finalWhere = whereClause && accessWhere ? and(whereClause, accessWhere) : whereClause || accessWhere

    let query = (db as any).select({ count: sql<number>`count(*)` }).from(table)

    if (finalWhere) {
      query = query.where(finalWhere) as any
    }

    const start = performance.now()
    try {
      const results = await query
      return results[0]?.count || 0
    } finally {
      this.metrics?.recordQuery(queryDef.entity, 'count', performance.now() - start)
    }
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Build WHERE clause from Blueprint conditions
   */
  private buildWhere(where: any, context: QueryContext, entityName?: string): SQL | undefined {
    if (!where) return undefined

    const targetEntity = typeof where?.entity === 'string' ? where.entity : entityName
    const table = targetEntity ? this.connection.getTable(targetEntity) : undefined

    // Handle AND/OR operators
    if (where.and) {
      const conditions = where.and.map((w: any) => this.buildWhere(w, context, targetEntity)).filter(Boolean)
      return conditions.length > 0 ? and(...conditions) : undefined
    }

    if (where.or) {
      const conditions = where.or.map((w: any) => this.buildWhere(w, context, targetEntity)).filter(Boolean)
      return conditions.length > 0 ? or(...conditions) : undefined
    }

    // Handle field conditions
    const conditions = []
    for (const [key, value] of Object.entries(where)) {
      if (key === 'and' || key === 'or' || key === 'entity') continue

      // Replace $params.x, $query.x, and $currentUser.x with actual values
      let actualValue = value
      if (typeof value === 'string' && value.startsWith('$params.')) {
        const paramKey = value.substring(8)
        actualValue = context.params?.[paramKey]
      } else if (typeof value === 'string' && value.startsWith('$query.')) {
        const queryKey = value.substring(7)
        actualValue = context.query?.[queryKey]
      } else if (typeof value === 'string' && value.startsWith('$currentUser.')) {
        const sessionKey = value.substring(13)
        actualValue = context.session?.user?.[sessionKey]
      } else if (typeof value === 'string' && value === '$currentUser.id') {
        actualValue = context.session?.user?.id
      }

      const column = table?.[key]
      if (!column) continue

      // Handle operators
      if (typeof actualValue === 'object' && actualValue !== null) {
        if ('gt' in actualValue) {
          conditions.push(gt(column, actualValue.gt))
        }
        if ('gte' in actualValue) {
          conditions.push(gte(column, actualValue.gte))
        }
        if ('lt' in actualValue) {
          conditions.push(lt(column, actualValue.lt))
        }
        if ('lte' in actualValue) {
          conditions.push(lte(column, actualValue.lte))
        }
        if ('like' in actualValue) {
          conditions.push(like(column, String(actualValue.like)))
        }
      } else {
        // Simple equality
        conditions.push(eq(column, actualValue))
      }
    }

    return conditions.length > 0 ? and(...conditions) : undefined
  }

  /**
   * Convert camelCase keys to snake_case for database
   */
  private toSnakeCase(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = this.toSnakeCaseString(key)
      result[snakeKey] = value
    }
    return result
  }

  private normalizeEntityValues(
    entity: { name: string; fields: Array<{ name: string; type: string }> } | undefined,
    data: Record<string, any>
  ): Record<string, any> {
    if (!entity) return data

    const normalized = { ...data }
    for (const field of entity.fields) {
      if (field.type !== 'DateTime' || !Object.prototype.hasOwnProperty.call(normalized, field.name)) {
        continue
      }

      const value = normalized[field.name]
      if (value === '' || value === null || value === undefined) {
        normalized[field.name] = null
        continue
      }

      if (value === 'now') {
        normalized[field.name] = new Date()
        continue
      }

      const utcValue = typeof value === 'string' && value.includes('T') && !value.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(value)
        ? `${value}Z`
        : value
      const date = utcValue instanceof Date ? utcValue : new Date(utcValue)
      if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid DateTime value for ${entity.name}.${field.name}`)
      }
      normalized[field.name] = date
    }

    return normalized
  }

  /**
   * Convert a camelCase string to snake_case
   */
  private toSnakeCaseString(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
  }

  /**
   * Convert snake_case keys to camelCase
   */
  private toCamelCase(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = this.toCamelCaseString(key)
      result[camelKey] = value
    }
    return result
  }

  /**
   * Convert a snake_case string to camelCase
   */
  private toCamelCaseString(str: string): string {
    return str.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase())
  }

}
