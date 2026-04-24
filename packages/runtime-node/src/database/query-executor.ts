/**
 * Query Executor
 *
 * Executes Blueprint queries using Drizzle ORM.
 * Translates Blueprint query syntax to SQL.
 */

import { eq, and, or, gt, gte, lt, lte, like, asc, desc, sql, SQL } from 'drizzle-orm'
import type { Query } from '@zebric/runtime-core'
import type { DatabaseConnection } from './connection.js'
import type { UserSession, PermissionManager } from '@zebric/runtime-core'
import { AccessControl } from '@zebric/runtime-core'
import { ulid } from 'ulid'
import { MetricsRegistry } from '../monitoring/metrics.js'
// performance.now() is available as a Web API (no import needed)

export interface QueryContext {
  params?: Record<string, string>
  query?: Record<string, string>
  session?: UserSession | null
}

export class QueryExecutor {
  private permissionManager?: PermissionManager

  constructor(
    private connection: DatabaseConnection,
    permissionManager?: PermissionManager,
    private metrics?: MetricsRegistry
  ) {
    this.permissionManager = permissionManager
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
    const db = this.connection.getDb()
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
    const db = this.connection.getDb()
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

    const orCondition = columns.length === 1
      ? like(columns[0], pattern)
      : or(...columns.map((c) => like(c, pattern)))

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
  async findById(entityName: string, id: string): Promise<any | null> {
    const db = this.connection.getDb()
    const table = this.connection.getTable(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    const start = performance.now()
    try {
      const results = await (db as any)
        .select()
        .from(table)
        .where(eq(table.id, id))
        .limit(1)

      const record = results[0] || null
      // Convert snake_case to camelCase for API consistency
      return record ? this.toCamelCase(record) : null
    } finally {
      this.metrics?.recordQuery(entityName, 'readById', performance.now() - start)
    }
  }

  /**
   * Create a new record
   */
  async create(entityName: string, data: Record<string, any>, context?: QueryContext): Promise<any> {
    const db = this.connection.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

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
    const dbData = this.toSnakeCase(data)

    const start = performance.now()
    try {
      const inserted = await (db as any).insert(table).values(dbData).returning()
      const record = inserted?.[0]
      if (record) {
        return this.toCamelCase(record)
      }

      return await this.findById(entityName, data.id)
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
    const db = this.connection.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    // Fetch existing record first for access control check
    const existingRecord = await this.findById(entityName, id)
    if (!existingRecord) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

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

    // Update timestamp
    const now = new Date()
    if (table.updatedAt) {
      data.updatedAt = now
    }

    // Convert camelCase to snake_case
    const dbData = this.toSnakeCase(data)

    const start = performance.now()
    try {
      // Update record
      await (db as any)
        .update(table)
        .set(dbData)
        .where(eq(table.id, id))

      // Return updated record
      return await this.findById(entityName, id)
    } finally {
      this.metrics?.recordQuery(entityName, 'update', performance.now() - start)
    }
  }

  /**
   * Delete a record
   */
  async delete(entityName: string, id: string, context?: QueryContext): Promise<void> {
    const db = this.connection.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    // Check delete access
    if (entity) {
      const hasAccess = await AccessControl.checkAccess({
        session: context?.session,
        action: 'delete',
        entity,
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
    const db = this.connection.getDb()
    const table = this.connection.getTable(queryDef.entity)

    if (!table) {
      throw new Error(`Entity ${queryDef.entity} not found`)
    }

    const whereClause = this.buildWhere(queryDef.where, context, queryDef.entity)

    let query = (db as any).select({ count: sql<number>`count(*)` }).from(table)

    if (whereClause) {
      query = query.where(whereClause) as any
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
