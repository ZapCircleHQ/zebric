/**
 * Workers Query Executor
 *
 * Implements QueryExecutorPort for CloudFlare Workers using D1 SQLite database.
 * Translates Blueprint Query definitions into SQL and executes them via D1Adapter.
 */

import type { Query, Entity, Blueprint } from '@zebric/runtime-core'
import type { QueryExecutorPort, RequestContext } from '@zebric/runtime-core'
import type { D1Adapter } from '../database/d1-adapter.js'

export class WorkersQueryExecutor implements QueryExecutorPort {
  constructor(
    private adapter: D1Adapter,
    private blueprint: Blueprint
  ) {}

  /**
   * Execute a Blueprint Query definition
   */
  async execute(query: Query, context: RequestContext): Promise<any> {
    const entity = this.getEntity(query.entity)
    if (!entity) {
      throw new Error(`Entity not found: ${query.entity}`)
    }

    // Build SQL query
    const sql = this.buildSelectQuery(entity, query, context)
    const params = this.buildQueryParams(query, context)

    // Execute query
    const result = await this.adapter.query(sql, params)
    return result.rows
  }

  /**
   * Create a new record
   */
  async create(entity: string, data: Record<string, any>, context: RequestContext): Promise<any> {
    const entityDef = this.getEntity(entity)
    if (!entityDef) {
      throw new Error(`Entity not found: ${entity}`)
    }

    // Filter data to only include defined fields
    const filteredData = this.filterFields(entityDef, data)

    // Build INSERT query
    const fields = Object.keys(filteredData)
    const values = Object.values(filteredData)
    const placeholders = fields.map(() => '?').join(', ')

    const sql = `
      INSERT INTO ${this.quoteIdentifier(entity)}
      (${fields.map(f => this.quoteIdentifier(f)).join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `

    const result = await this.adapter.query(sql, values)
    return result.rows[0] || { ...filteredData }
  }

  /**
   * Update an existing record
   */
  async update(
    entity: string,
    id: string,
    data: Record<string, any>,
    context: RequestContext
  ): Promise<any> {
    const entityDef = this.getEntity(entity)
    if (!entityDef) {
      throw new Error(`Entity not found: ${entity}`)
    }

    // Filter data to only include defined fields
    const filteredData = this.filterFields(entityDef, data)

    // Build UPDATE query
    const fields = Object.keys(filteredData)
    const values = Object.values(filteredData)
    const setClause = fields.map(f => `${this.quoteIdentifier(f)} = ?`).join(', ')

    const sql = `
      UPDATE ${this.quoteIdentifier(entity)}
      SET ${setClause}
      WHERE id = ?
      RETURNING *
    `

    const result = await this.adapter.query(sql, [...values, id])
    return result.rows[0] || { id, ...filteredData }
  }

  /**
   * Delete a record
   */
  async delete(entity: string, id: string, context: RequestContext): Promise<any> {
    const entityDef = this.getEntity(entity)
    if (!entityDef) {
      throw new Error(`Entity not found: ${entity}`)
    }

    const sql = `
      DELETE FROM ${this.quoteIdentifier(entity)}
      WHERE id = ?
    `

    await this.adapter.query(sql, [id])
  }

  /**
   * Find a record by ID
   */
  async findById(entity: string, id: string): Promise<any> {
    const entityDef = this.getEntity(entity)
    if (!entityDef) {
      throw new Error(`Entity not found: ${entity}`)
    }

    const sql = `
      SELECT * FROM ${this.quoteIdentifier(entity)}
      WHERE id = ?
      LIMIT 1
    `

    const result = await this.adapter.query(sql, [id])
    return result.rows[0] || null
  }

  /**
   * OR-across-fields substring search via SQL LIKE. Fields not declared on
   * the entity are silently dropped to match the blueprint's authorization
   * posture — only declared fields are addressable.
   */
  async search(
    entityName: string,
    fields: string[],
    query: string,
    options: { limit?: number; filter?: Record<string, any>; context?: RequestContext } = {}
  ): Promise<any[]> {
    const entityDef = this.getEntity(entityName)
    if (!entityDef) {
      throw new Error(`Entity not found: ${entityName}`)
    }

    const trimmed = String(query ?? '').trim()
    if (!trimmed) return []

    const validFields = fields.filter((f) => entityDef.fields.some((ef) => ef.name === f))
    if (validFields.length === 0) return []

    const escaped = trimmed.replace(/[%_]/g, (c) => '\\' + c)
    const pattern = `%${escaped}%`

    const orClauses = validFields.map((f) => `${this.quoteIdentifier(f)} LIKE ? ESCAPE '\\'`).join(' OR ')
    const params: any[] = validFields.map(() => pattern)

    let whereSql = `(${orClauses})`
    if (options.filter) {
      const filterClause = this.buildWhereClause(options.filter, options.context ?? {})
      if (filterClause) {
        whereSql = `${whereSql} AND (${filterClause})`
        params.push(...this.buildQueryParams({ entity: entityName, where: options.filter }, options.context ?? {}))
      }
    }

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)
    const sql = `SELECT * FROM ${this.quoteIdentifier(entityName)} WHERE ${whereSql} LIMIT ${limit}`

    const result = await this.adapter.query(sql, params)
    return result.rows || []
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private getEntity(name: string): Entity | undefined {
    return this.blueprint.entities?.find((e: Entity) => e.name === name)
  }

  private filterFields(entity: Entity, data: Record<string, any>): Record<string, any> {
    const filtered: Record<string, any> = {}

    for (const field of entity.fields || []) {
      if (data[field.name] !== undefined) {
        filtered[field.name] = this.coerceForSqlite(data[field.name], field.type)
      }
    }

    return filtered
  }

  /**
   * Coerce values into the shapes D1/SQLite can bind: numbers, strings,
   * bigints, ArrayBuffers, or null. Booleans become 0/1, Dates become ISO
   * strings, objects become JSON, undefined becomes null.
   */
  private coerceForSqlite(value: any, fieldType?: string): any {
    if (value === undefined) return null
    if (value === null) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    if (value instanceof Date) return value.toISOString()
    if (fieldType === 'JSON' && typeof value === 'object') return JSON.stringify(value)
    if (typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
      return JSON.stringify(value)
    }
    return value
  }

  private buildSelectQuery(entity: Entity, query: Query, context: RequestContext): string {
    const tableName = this.quoteIdentifier(query.entity)
    let sql = `SELECT * FROM ${tableName}`

    // WHERE clause
    if (query.where) {
      const whereClause = this.buildWhereClause(query.where, context)
      if (whereClause) {
        sql += ` WHERE ${whereClause}`
      }
    }

    // ORDER BY clause
    if (query.orderBy) {
      const orderClauses = Object.entries(query.orderBy).map(
        ([field, direction]) => `${this.quoteIdentifier(field)} ${direction.toUpperCase()}`
      )
      sql += ` ORDER BY ${orderClauses.join(', ')}`
    }

    // LIMIT clause
    if (query.limit) {
      sql += ` LIMIT ${query.limit}`
    }

    // OFFSET clause
    if (query.offset) {
      sql += ` OFFSET ${query.offset}`
    }

    return sql
  }

  private buildWhereClause(where: Record<string, any>, context: RequestContext): string {
    const conditions: string[] = []

    for (const [field, value] of Object.entries(where)) {
      // Handle parameter references like {user_id}
      if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
        const paramName = value.slice(1, -1)
        const paramValue = context.params?.[paramName] || context.session?.userId

        if (paramValue !== undefined) {
          conditions.push(`${this.quoteIdentifier(field)} = ?`)
        }
        continue
      }

      // Handle operators
      if (typeof value === 'object' && value !== null) {
        for (const [op, opValue] of Object.entries(value)) {
          switch (op) {
            case '$eq':
              conditions.push(`${this.quoteIdentifier(field)} = ?`)
              break
            case '$ne':
              conditions.push(`${this.quoteIdentifier(field)} != ?`)
              break
            case '$gt':
              conditions.push(`${this.quoteIdentifier(field)} > ?`)
              break
            case '$gte':
              conditions.push(`${this.quoteIdentifier(field)} >= ?`)
              break
            case '$lt':
              conditions.push(`${this.quoteIdentifier(field)} < ?`)
              break
            case '$lte':
              conditions.push(`${this.quoteIdentifier(field)} <= ?`)
              break
            case '$in':
              if (Array.isArray(opValue) && opValue.length > 0) {
                const placeholders = opValue.map(() => '?').join(', ')
                conditions.push(`${this.quoteIdentifier(field)} IN (${placeholders})`)
              }
              break
            case '$like':
              conditions.push(`${this.quoteIdentifier(field)} LIKE ?`)
              break
            case '$null':
              conditions.push(
                opValue
                  ? `${this.quoteIdentifier(field)} IS NULL`
                  : `${this.quoteIdentifier(field)} IS NOT NULL`
              )
              break
            default:
              console.warn(`Unknown operator: ${op}`)
          }
        }
      } else {
        // Simple equality
        conditions.push(`${this.quoteIdentifier(field)} = ?`)
      }
    }

    return conditions.join(' AND ')
  }

  private buildQueryParams(query: Query, context: RequestContext): any[] {
    if (!query.where) {
      return []
    }

    const params: any[] = []

    for (const [field, value] of Object.entries(query.where)) {
      // Handle parameter references like {user_id}
      if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
        const paramName = value.slice(1, -1)
        const paramValue = context.params?.[paramName] || context.session?.userId

        if (paramValue !== undefined) {
          params.push(paramValue)
        }
        continue
      }

      // Handle operators
      if (typeof value === 'object' && value !== null) {
        for (const [op, opValue] of Object.entries(value)) {
          if (op === '$in' && Array.isArray(opValue)) {
            params.push(...opValue)
          } else if (op !== '$null') {
            params.push(opValue)
          }
        }
      } else {
        // Simple equality
        params.push(value)
      }
    }

    return params
  }

  private quoteIdentifier(identifier: string): string {
    // SQLite uses double quotes for identifiers
    return `"${identifier.replace(/"/g, '""')}"`
  }
}
