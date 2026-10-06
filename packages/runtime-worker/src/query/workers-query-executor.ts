/**
 * Workers Query Executor
 *
 * Implements QueryExecutorPort for CloudFlare Workers using D1 SQLite database.
 * Translates Blueprint Query definitions into SQL and executes them via D1Adapter.
 */

import type { Query, Entity, Blueprint, QueryPredicate } from '@zebric/runtime-core'
import type { QueryExecutorPort, RequestContext, SqlStoragePort } from '@zebric/runtime-core'
import { D1Adapter } from '../database/d1-adapter.js'
import { D1Transactions, type TransactionReceipt } from '../database/d1-transactions.js'
import type { WorkflowEventIntent } from '../workflows/d1-workflow-outbox.js'
import { AccessControl, PermissionManager, PolicyEvaluator, assertEntityAccess, assertProtectedMutation, filterReadableFields, filterRecordsByReadPolicy, filterWritableFields, isSystemSession, normalizeQueryWhere, requiresRecordEvaluation } from '@zebric/runtime-core'

export class WorkersQueryExecutor implements QueryExecutorPort {
  private permissionManager: PermissionManager
  private readonly policyEvaluator: PolicyEvaluator

  constructor(
    private adapter: SqlStoragePort,
    private blueprint: Blueprint
  ) {
    if (adapter instanceof D1Adapter) this.adapter = new D1Transactions(adapter, blueprint)
    this.permissionManager = new PermissionManager(blueprint.auth)
    this.policyEvaluator = new PolicyEvaluator(blueprint, this)
  }

  async transaction<T>(operation: () => Promise<T>, receipt?: TransactionReceipt): Promise<T> {
    if (!(this.adapter instanceof D1Transactions)) throw new Error('Transactions require a D1 adapter')
    return this.adapter.transaction(operation, receipt)
  }

  async afterCommit(effect: () => Promise<void> | void): Promise<void> {
    if (this.adapter instanceof D1Transactions) await this.adapter.afterCommit(effect)
    else await effect()
  }

  async enqueueWorkflowEvent(intent: WorkflowEventIntent, id?: string): Promise<void> {
    if (!(this.adapter instanceof D1Transactions)) throw new Error('Workflow outbox intents require a D1 adapter')
    await this.adapter.enqueueWorkflowEvent(intent, id)
  }

  async executeBatch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    if (!(this.adapter instanceof D1Transactions)) throw new Error('Atomic batches require a D1 adapter')
    await this.adapter.batch(statements)
  }

  /**
   * Execute a Blueprint Query definition
   */
  async execute(query: Query, context: RequestContext): Promise<any> {
    const entity = this.getEntity(query.entity)
    if (!entity) {
      throw new Error(`Entity not found: ${query.entity}`)
    }

    await assertEntityAccess({
      entity,
      action: 'read',
      session: context.session,
      permissionManager: this.permissionManager,
      policyEvaluator: this.policyEvaluator,
    })
    const accessFilter = AccessControl.getFilterConditions(entity, context.session)
    if (AccessControl.isImpossibleFilter(accessFilter)) {
      throw new Error(`Access denied: Cannot read ${entity.name}`)
    }

    // Build SQL query with caller filters and row-level access filters.
    const combinedWhere = query.where && accessFilter
      ? { and: [query.where, accessFilter] }
      : query.where || accessFilter || undefined
    const paginateAfterPolicy = !isSystemSession(context.session)
      && (requiresRecordEvaluation(entity.access?.read)
        || this.permissionManager.requiresRecordCheck(entity.name, 'read'))
    const securedQuery = paginateAfterPolicy
      ? { ...query, where: combinedWhere, limit: undefined, offset: undefined }
      : { ...query, where: combinedWhere }
    const allowedFields = new Set(entity.fields.map(field => field.name))
    const compiledWhere = this.compilePredicate(normalizeQueryWhere(securedQuery.where, context, { allowedFields }))
    const sql = this.buildSelectQuery(securedQuery, compiledWhere.sql)

    // Execute query
    const result = await this.adapter.query(sql, compiledWhere.params)
    const secured = await filterRecordsByReadPolicy(
      entity,
      result.rows as Record<string, any>[],
      context.session,
      this.policyEvaluator,
      this.permissionManager,
    )
    const paginated = paginateAfterPolicy
      ? secured.slice(query.offset ?? 0, query.limit == null ? undefined : (query.offset ?? 0) + query.limit)
      : secured
    return filterReadableFields(entity, paginated, context.session)
  }

  /**
   * Create a new record
   */
  async create(entity: string, data: Record<string, any>, context: RequestContext): Promise<any> {
    const entityDef = this.getEntity(entity)
    if (!entityDef) {
      throw new Error(`Entity not found: ${entity}`)
    }

    assertProtectedMutation(entityDef, data, context)

    // Drop fields the caller may not write, then check entity-level create access.
    const writable = filterWritableFields(entityDef, data, context.session)
    await assertEntityAccess({
      entity: entityDef,
      action: 'create',
      data: writable,
      session: context.session,
      permissionManager: this.permissionManager,
      policyEvaluator: this.policyEvaluator,
    })

    // Filter data to only include defined fields
    const filteredData = this.filterFields(entityDef, writable)

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
    return filterReadableFields(entityDef, result.rows[0] || { ...filteredData }, context.session)
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

    assertProtectedMutation(entityDef, data, context)

    const existing = await this.findByIdUnrestricted(entity, id)
    if (!existing) {
      throw new Error(`${entity} with id ${id} not found`)
    }

    // Drop fields the caller may not write, then authorize the stored resource.
    // Proposed ownership values must not grant access to the update itself.
    const writable = filterWritableFields(entityDef, data, context.session)
    await assertEntityAccess({
      entity: entityDef,
      action: 'update',
      data: existing,
      session: context.session,
      permissionManager: this.permissionManager,
      policyEvaluator: this.policyEvaluator,
    })

    // Filter data to only include defined fields
    const filteredData = this.filterFields(entityDef, writable)

    // Every supplied field was stripped as unwritable - nothing to persist.
    if (Object.keys(filteredData).length === 0) {
      return existing ?? { id }
    }

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
    return filterReadableFields(
      entityDef,
      result.rows[0] || { ...(existing ?? {}), ...filteredData, id },
      context.session
    )
  }

  /**
   * Delete a record
   */
  async delete(entity: string, id: string, context: RequestContext): Promise<any> {
    const entityDef = this.getEntity(entity)
    if (!entityDef) {
      throw new Error(`Entity not found: ${entity}`)
    }

    // Missing row: nothing to authorize against, DELETE is a harmless no-op.
    const existing = await this.findByIdUnrestricted(entity, id)
    if (existing) {
      await assertEntityAccess({
        entity: entityDef,
        action: 'delete',
        data: existing,
        session: context.session,
        permissionManager: this.permissionManager,
        policyEvaluator: this.policyEvaluator,
      })
    }

    const sql = `
      DELETE FROM ${this.quoteIdentifier(entity)}
      WHERE id = ?
    `

    await this.adapter.query(sql, [id])
  }

  /**
   * Authorize and compile one fixed workflow mutation without executing it.
   * The Worker workflow executor prepares every statement first, then submits
   * the complete set to D1's atomic batch primitive.
   */
  async prepareBatchMutation(
    entity: string,
    action: 'create' | 'update' | 'delete',
    data: Record<string, any> | undefined,
    where: Record<string, any> | undefined,
    context: RequestContext,
  ): Promise<Array<{ sql: string; params: unknown[] }>> {
    const entityDef = this.getEntity(entity)
    if (!entityDef) throw new Error(`Entity not found: ${entity}`)

    if (action === 'create') {
      if (!data) throw new Error('Create action requires data')
      assertProtectedMutation(entityDef, data, context)
      const writable = filterWritableFields(entityDef, data, context.session)
      await assertEntityAccess({
        entity: entityDef,
        action: 'create',
        data: writable,
        session: context.session,
        permissionManager: this.permissionManager,
        policyEvaluator: this.policyEvaluator,
      })
      const filtered = this.filterFields(entityDef, writable)
      const fields = Object.keys(filtered)
      if (fields.length === 0) throw new Error(`Create ${entity} has no writable fields`)
      return [{
        sql: `INSERT INTO ${this.quoteIdentifier(entity)} (${fields.map(field => this.quoteIdentifier(field)).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
        params: Object.values(filtered),
      }]
    }

    const id = typeof where?.id === 'string' || typeof where?.id === 'number'
      ? String(where.id)
      : undefined
    if (!id) throw new Error(`${action[0]!.toUpperCase()}${action.slice(1)} action requires an id in the where clause`)
    const mutationWhere = where as Record<string, any>
    const existing = await this.findByIdUnrestricted(entity, id)
    if (!existing && action === 'update') throw new Error(`${entity} with id ${id} not found`)

    if (action === 'delete') {
      if (existing) {
        await assertEntityAccess({
          entity: entityDef,
          action: 'delete',
          data: existing,
          session: context.session,
          permissionManager: this.permissionManager,
          policyEvaluator: this.policyEvaluator,
        })
      }
      const predicate = this.compileWorkflowWhere(entityDef, mutationWhere, context)
      return [
        this.workflowPredicateGuard(entity, id, predicate),
        {
          sql: `DELETE FROM ${this.quoteIdentifier(entity)} WHERE ${predicate.sql}`,
          params: predicate.params,
        },
      ]
    }

    if (!data) throw new Error('Update action requires data')
    assertProtectedMutation(entityDef, data, context)
    const writable = filterWritableFields(entityDef, data, context.session)
    await assertEntityAccess({
      entity: entityDef,
      action: 'update',
      data: existing,
      session: context.session,
      permissionManager: this.permissionManager,
      policyEvaluator: this.policyEvaluator,
    })
    const filtered = this.filterFields(entityDef, writable)
    const fields = Object.keys(filtered)
    if (fields.length === 0) throw new Error(`Update ${entity} has no writable fields`)
    const predicate = this.compileWorkflowWhere(entityDef, mutationWhere, context)
    return [
      this.workflowPredicateGuard(entity, id, predicate),
      {
        sql: `UPDATE ${this.quoteIdentifier(entity)} SET ${fields.map(field => `${this.quoteIdentifier(field)} = ?`).join(', ')} WHERE ${predicate.sql}`,
        params: [...Object.values(filtered), ...predicate.params],
      },
    ]
  }

  /**
   * Find a record by ID
   */
  async findById(entity: string, id: string, context: RequestContext = {}): Promise<any> {
    const rows = await this.execute({ entity, where: { id }, limit: 1 }, context)
    return rows[0] || null
  }

  private async findByIdUnrestricted(entity: string, id: string): Promise<any> {
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

    await assertEntityAccess({
      entity: entityDef,
      action: 'read',
      session: options.context?.session,
      permissionManager: this.permissionManager,
      policyEvaluator: this.policyEvaluator,
    })
    const accessFilter = AccessControl.getFilterConditions(entityDef, options.context?.session)
    if (AccessControl.isImpossibleFilter(accessFilter)) {
      throw new Error(`Access denied: Cannot read ${entityName}`)
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
      const filter = this.compilePredicate(normalizeQueryWhere(
        options.filter,
        options.context ?? {},
        { allowedFields: new Set(entityDef.fields.map(field => field.name)) },
      ))
      if (filter.sql) {
        whereSql = `${whereSql} AND (${filter.sql})`
        params.push(...filter.params)
      }
    }
    if (accessFilter) {
      const access = this.compilePredicate(normalizeQueryWhere(
        accessFilter,
        options.context ?? {},
        { allowedFields: new Set(entityDef.fields.map(field => field.name)) },
      ))
      if (access.sql) {
        whereSql = `${whereSql} AND (${access.sql})`
        params.push(...access.params)
      }
    }

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)
    const limitAfterPolicy = !isSystemSession(options.context?.session)
      && (requiresRecordEvaluation(entityDef.access?.read)
        || this.permissionManager.requiresRecordCheck(entityName, 'read'))
    const sql = `SELECT * FROM ${this.quoteIdentifier(entityName)} WHERE ${whereSql}${limitAfterPolicy ? '' : ` LIMIT ${limit}`}`

    const result = await this.adapter.query(sql, params)
    const secured = await filterRecordsByReadPolicy(
      entityDef,
      (result.rows || []) as Record<string, any>[],
      options.context?.session,
      this.policyEvaluator,
      this.permissionManager,
    )
    return filterReadableFields(
      entityDef,
      limitAfterPolicy ? secured.slice(0, limit) : secured,
      options.context?.session,
    )
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

  private buildSelectQuery(query: Query, whereClause: string): string {
    const tableName = this.quoteIdentifier(query.entity)
    let sql = `SELECT * FROM ${tableName}`

    if (whereClause) {
      sql += ` WHERE ${whereClause}`
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

  private compilePredicate(predicate: QueryPredicate | undefined): { sql: string; params: any[] } {
    if (!predicate) return { sql: '', params: [] }
    if (predicate.kind === 'constant') {
      return { sql: predicate.value ? '1 = 1' : '1 = 0', params: [] }
    }
    if (predicate.kind === 'group') {
      const children = predicate.predicates.map(child => this.compilePredicate(child))
      if (children.length === 0) {
        return { sql: predicate.operator === 'and' ? '1 = 1' : '1 = 0', params: [] }
      }
      return {
        sql: children.map(child => `(${child.sql})`).join(` ${predicate.operator.toUpperCase()} `),
        params: children.flatMap(child => child.params),
      }
    }

    const field = this.quoteIdentifier(predicate.field)
    switch (predicate.operator) {
      case 'eq': return predicate.value === null
        ? { sql: `${field} IS NULL`, params: [] }
        : { sql: `${field} = ?`, params: [this.coerceQueryValue(predicate.value)] }
      case 'ne': return predicate.value === null
        ? { sql: `${field} IS NOT NULL`, params: [] }
        : { sql: `${field} != ?`, params: [this.coerceQueryValue(predicate.value)] }
      case 'gt': return { sql: `${field} > ?`, params: [this.coerceQueryValue(predicate.value)] }
      case 'gte': return { sql: `${field} >= ?`, params: [this.coerceQueryValue(predicate.value)] }
      case 'lt': return { sql: `${field} < ?`, params: [this.coerceQueryValue(predicate.value)] }
      case 'lte': return { sql: `${field} <= ?`, params: [this.coerceQueryValue(predicate.value)] }
      case 'like': return { sql: `${field} LIKE ?`, params: [String(predicate.value)] }
      case 'null': return { sql: `${field} IS ${predicate.value ? '' : 'NOT '}NULL`, params: [] }
      case 'in': {
        if (!Array.isArray(predicate.value) || predicate.value.length === 0) {
          return { sql: '1 = 0', params: [] }
        }
        return {
          sql: `${field} IN (${predicate.value.map(() => '?').join(', ')})`,
          params: predicate.value.map(value => this.coerceQueryValue(value)),
        }
      }
    }
  }

  private coerceQueryValue(value: unknown): unknown {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (value instanceof Date) return value.toISOString()
    if (value !== null && typeof value === 'object') return JSON.stringify(value)
    return value
  }

  private compileWorkflowWhere(entity: Entity, where: Record<string, any>, context: RequestContext): { sql: string; params: any[] } {
    const predicate = normalizeQueryWhere(where, context, {
      allowedFields: new Set(entity.fields.map(field => field.name)),
    })
    const compiled = this.compilePredicate(predicate)
    if (!compiled.sql) throw new Error('Workflow mutation requires a where clause')
    return compiled
  }

  /**
   * Turn a stale conditional mutation into a batch failure. If the row still
   * exists but no longer matches its workflow predicate, this attempts to
   * insert its existing id and deliberately trips the primary-key constraint.
   */
  private workflowPredicateGuard(
    entity: string,
    id: string,
    predicate: { sql: string; params: any[] },
  ): { sql: string; params: unknown[] } {
    const table = this.quoteIdentifier(entity)
    return {
      sql: `INSERT INTO ${table} ("id") SELECT "id" FROM ${table} WHERE "id" = ? AND (${predicate.sql}) IS NOT TRUE`,
      params: [id, ...predicate.params],
    }
  }

  private quoteIdentifier(identifier: string): string {
    // SQLite uses double quotes for identifiers
    return `"${identifier.replace(/"/g, '""')}"`
  }
}
