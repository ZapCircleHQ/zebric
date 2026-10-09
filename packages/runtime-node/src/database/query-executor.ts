/**
 * Query Executor
 *
 * Executes Blueprint queries using Drizzle ORM.
 * Translates Blueprint query syntax to SQL.
 */

import { SqlChangeJournal, resolveLiveConfig, type LiveChangeSource } from '@zebric/runtime-core'
import { eq, ne, and, or, gt, gte, lt, lte, like, ilike, inArray, isNull, isNotNull, asc, desc, sql, SQL } from 'drizzle-orm'
import type { Query, Entity, QueryPredicate, RequestContext } from '@zebric/runtime-core'
import type { DatabaseConnection } from './connection.js'
import type { PermissionManager } from '@zebric/runtime-core'
import { AccessControl, PolicyEvaluator, SYSTEM_SESSION, assertEntityAccess, assertProtectedMutation, filterReadableFields, filterRecordsByReadPolicy, filterWritableFields, isSystemSession, normalizeQueryWhere, requiresRecordEvaluation } from '@zebric/runtime-core'
import { ulid } from 'ulid'
import { MetricsRegistry } from '../monitoring/metrics.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { encodeRuntimeValue, decodeRuntimeValue } from './runtime-codec.js'
// performance.now() is available as a Web API (no import needed)

export type QueryContext = RequestContext

export interface DurableReceipt { key: string; fingerprint: string }
export class IdempotencyConflictError extends Error {
  constructor() { super('Idempotency key was reused with different input') }
}

export interface AuditOutboxRecord {
  id: string
  topic: string
  payload: string
  createdAt: number
}

export class QueryExecutor {
  readonly liveChanges: LiveChangeSource
  private readonly changeJournal: SqlChangeJournal
  private get recordsLiveChanges(): boolean {
    return typeof this.connection.getBlueprint === 'function' && Boolean(this.connection.getBlueprint()?.pages?.some(page => page.live))
  }

  private async recordChange(entity: string, operation: 'create' | 'update' | 'delete', id: string): Promise<void> {
    if (!this.recordsLiveChanges) return
    // PostgreSQL sequence allocation must follow commit order for reconciliation.
    await this.lockRuntimeDelivery('live-changes')
    const statement = this.changeJournal.prepare(entity, operation, id)
    await this.queryChangeStorage(statement.sql, statement.params)
  }

  private async queryChangeStorage<T>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const parts = text.split('?')
    const chunks: SQL[] = [sql.raw(parts[0]!)]
    for (let i = 0; i < params.length; i++) chunks.push(sql`${params[i]}`, sql.raw(parts[i + 1]!))
    return { rows: await this.queryRuntime<T>(sql.join(chunks, sql.raw(''))) }
  }

  private permissionManager?: PermissionManager
  private readonly policyEvaluator: PolicyEvaluator
  private readonly transactionContext = new AsyncLocalStorage<{
    token: symbol
    db?: any
    afterCommit: Array<() => Promise<void> | void>
    closed: boolean
    signal?: AbortSignal
  }>()
  private readonly operationSignal = new AsyncLocalStorage<AbortSignal>()
  withAbortSignal<T>(signal: AbortSignal, operation: () => T): T { return this.operationSignal.run(signal, operation) }
  private activeTransaction?: { token: symbol; done: Promise<void> }
  private mutationObserver?: (event: { entity: string; event: 'create' | 'update' | 'delete'; before?: any; after?: any; context?: QueryContext }) => Promise<void>

  setMutationObserver(observer: NonNullable<QueryExecutor['mutationObserver']>): void { this.mutationObserver = observer }
  outsideTransaction<T>(fn: () => T): T { return this.transactionContext.exit(() => this.operationSignal.exit(fn)) }

  private transactionTail: Promise<void> = Promise.resolve()

  constructor(
    private connection: DatabaseConnection,
    permissionManager?: PermissionManager,
    private metrics?: MetricsRegistry
  ) {
    const blueprint = typeof (connection as any).getBlueprint === 'function'
      ? (connection as any).getBlueprint()
      : undefined
    this.changeJournal = new SqlChangeJournal(
      { query: (text, params) => this.queryChangeStorage(text, params) },
      resolveLiveConfig(blueprint).changeRetentionMs,
    )
    this.liveChanges = this.changeJournal
    this.permissionManager = permissionManager
    this.policyEvaluator = new PolicyEvaluator(blueprint, this)
  }

  /**
   * Execute a group of query operations as one database transaction.
   * Calls made through this executor from other async contexts wait until the
   * transaction completes, preventing them from joining a SQLite transaction.
   */
  async transaction<T>(fn: () => Promise<T>, receipt?: DurableReceipt, signal?: AbortSignal): Promise<T> {
    // Nested callers participate in the existing transaction.
    if (this.transactionContext.getStore()) {
      this.assertTransactionActive()
      if (receipt) throw new Error('Durable receipts require the outer transaction')
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
    let transactionReleased = false
    const releaseTransaction = () => {
      if (transactionReleased) return
      transactionReleased = true
      if (this.activeTransaction?.token === token) this.activeTransaction = undefined
      resolveDone()
      releaseQueue()
    }

    try {
      const db = this.connection.getDb() as any
      const afterCommit: Array<() => Promise<void> | void> = []
      const scope = { token, afterCommit, closed: false, signal, db: undefined as any }
      const operation = async () => {
        this.assertTransactionActive()
        if (receipt) {
          if (this.connection.getType() === 'postgres')
            await this.queryRuntime(sql`SELECT pg_advisory_xact_lock(hashtextextended(${receipt.key}, 0))`)
          const cached = await this.queryRuntime<{ fingerprint: string; value: string }>(
            sql`SELECT fingerprint, value FROM __zbl_command_receipts WHERE key = ${receipt.key}`)
          if (cached[0]) {
            if (cached[0].fingerprint !== receipt.fingerprint) throw new IdempotencyConflictError()
            return decodeRuntimeValue<T>(cached[0].value)
          }
        }
        const value = await fn()
        this.assertTransactionActive()
        if (receipt) await this.queryRuntime(sql`INSERT INTO __zbl_command_receipts (key, fingerprint, value)
          VALUES (${receipt.key}, ${receipt.fingerprint}, ${encodeRuntimeValue(value)})`)
        return value
      }
      let result: T
      if (this.connection.getType() === 'postgres') {
        try {
          result = await db.transaction((tx: any) => {
            scope.db = tx
            return this.transactionContext.run(scope, operation)
          })
        } finally { scope.closed = true }
        releaseTransaction()
        for (const effect of afterCommit) await effect()
        return result
      }

      const sqlite = this.connection.getSQLite()
      if (!sqlite) throw new Error('SQLite connection is not initialized')
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        result = await this.transactionContext.run(scope, operation)
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      } finally { scope.closed = true }
      releaseTransaction()
      for (const effect of afterCommit) await effect()
      return result
    } finally {
      releaseTransaction()
    }
  }

  async afterCommit(effect: () => Promise<void> | void): Promise<void> {
    this.assertTransactionActive()
    const context = this.transactionContext.getStore()
    if (context) context.afterCommit.push(effect)
    else await effect()
  }

  private getDb(): any {
    this.assertTransactionActive()
    return this.transactionContext.getStore()?.db ?? this.connection.getDb()
  }

  private async waitForTransaction(): Promise<void> {
    this.assertTransactionActive()
    const active = this.activeTransaction
    if (active && this.transactionContext.getStore()?.token !== active.token) {
      await active.done
    }
  }

  private assertTransactionActive(): void {
    this.operationSignal.getStore()?.throwIfAborted()
    const scope = this.transactionContext.getStore()
    if (scope?.closed) throw new Error('Transaction is no longer active')
    scope?.signal?.throwIfAborted()
  }

  get inTransaction(): boolean { return Boolean(this.transactionContext.getStore()) }
  getBlueprint() { return this.connection.getBlueprint() }

  async lockRuntimeDelivery(key: string): Promise<void> {
    if (!this.inTransaction) throw new Error('Runtime delivery locks require a transaction')
    if (this.connection.getType() === 'postgres')
      await this.queryRuntime(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
  }

  /** Trusted runtime storage; callers supply parameterized Drizzle statements. */
  async queryRuntime<T = Record<string, unknown>>(statement: SQL): Promise<T[]> {
    await this.waitForTransaction()
    const db = this.getDb()
    let result: any
    if (this.connection.getType() === 'postgres') result = await db.execute(statement)
    else {
      const compiled = new SQLiteSyncDialect().sqlToQuery(statement)
      const prepared = this.connection.getSQLite()!.prepare(compiled.sql)
      if (prepared.reader) result = prepared.all(...compiled.params)
      else { prepared.run(...compiled.params); result = [] }
    }
    return (Array.isArray(result) ? result : result?.rows ?? []) as T[]
  }

  /** Persist an audit intent in the caller's active database transaction. */
  async enqueueAuditOutbox(record: AuditOutboxRecord): Promise<void> {
    await this.waitForTransaction()
    if (!this.transactionContext.getStore()) {
      throw new Error('Audit outbox entries must be enqueued inside a database transaction')
    }
    const db = this.getDb() as any
    const statement = sql`INSERT INTO __zbl_audit_outbox (id, topic, payload, created_at) VALUES (${record.id}, ${record.topic}, ${record.payload}, ${record.createdAt}) ON CONFLICT(id) DO NOTHING`
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
      await assertEntityAccess({
        session: context.session,
        action: 'read',
        entity,
        permissionManager: this.permissionManager,
        policyEvaluator: this.policyEvaluator,
      })
    }

    // Build WHERE clause with access control filters
    const whereClause = this.buildWhere(queryDef.where, context, queryDef.entity)
    const accessFilters = entity ? AccessControl.getFilterConditions(entity, context.session) : null
    if (AccessControl.isImpossibleFilter(accessFilters)) {
      throw new Error(`Access denied: Cannot read ${queryDef.entity}`)
    }
    const paginateAfterPolicy = !isSystemSession(context.session)
      && (requiresRecordEvaluation(entity?.access?.read)
        || this.permissionManager?.requiresRecordCheck(queryDef.entity, 'read') === true)

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
    if (queryDef.limit && !paginateAfterPolicy) {
      query = query.limit(queryDef.limit) as any
    }

    // Apply OFFSET
    if (queryDef.offset && !paginateAfterPolicy) {
      query = query.offset(queryDef.offset) as any
    }

    const start = performance.now()
    try {
      const results = await query
      // Convert snake_case to camelCase for consistency with findById/create/update.
      if (!Array.isArray(results)) return results
      const records = results.map((record) => this.toCamelCase(record))
      const secured = await filterRecordsByReadPolicy(
        entity,
        records,
        context.session,
        this.policyEvaluator,
        this.permissionManager,
      )
      const paginated = paginateAfterPolicy
        ? secured.slice(queryDef.offset ?? 0, queryDef.limit == null
          ? undefined
          : (queryDef.offset ?? 0) + queryDef.limit)
        : secured
      return paginated.map(record => filterReadableFields(entity, record, context.session))
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
      await assertEntityAccess({
        session: options.context?.session,
        action: 'read',
        entity,
        permissionManager: this.permissionManager,
        policyEvaluator: this.policyEvaluator,
      })
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
    const limitAfterPolicy = !isSystemSession(options.context?.session)
      && (requiresRecordEvaluation(entity?.access?.read)
        || this.permissionManager?.requiresRecordCheck(entityName, 'read') === true)

    const start = performance.now()
    try {
      let results = (db as any)
        .select()
        .from(table)
        .where(where)
      if (!limitAfterPolicy) results = results.limit(limit)

      const rows = await results
      if (!Array.isArray(rows)) return []
      const records = rows.map((record) => this.toCamelCase(record))
      const secured = await filterRecordsByReadPolicy(
        entity,
        records,
        options.context?.session,
        this.policyEvaluator,
        this.permissionManager,
      )
      return (limitAfterPolicy ? secured.slice(0, limit) : secured)
        .map(record => filterReadableFields(entity, record, options.context?.session))
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
   * Create a new record
   */
  async create(entityName: string, data: Record<string, any>, context?: QueryContext): Promise<any> {
    if ((this.mutationObserver || this.recordsLiveChanges) && !this.inTransaction) return this.transaction(() => this.create(entityName, data, context))
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    assertProtectedMutation(entity, data, context)

    // Strip fields the caller cannot write before any access or default handling.
    data = filterWritableFields(entity, data, context?.session)

    // Check create access
    if (entity) {
      await assertEntityAccess({
        session: context?.session,
        action: 'create',
        entity,
        data,
        permissionManager: this.permissionManager,
        policyEvaluator: this.policyEvaluator,
      })
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
      this.assertTransactionActive()
      const inserted = await (db as any).insert(table).values(dbData).returning()
      const record = inserted?.[0]
      if (record) {
        const after = filterReadableFields(entity, this.toCamelCase(record), context?.session)
        await this.recordChange(entityName, 'create', String(record.id))
        await this.mutationObserver?.({ entity: entityName, event: 'create', after, context })
        return after
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
    if ((this.mutationObserver || this.recordsLiveChanges) && !this.inTransaction) return this.transaction(() => this.updateWhere(entityName, id, expected, data, context))
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    assertProtectedMutation(entity, data, context)

    // Fetch existing record first for access control check
    const existingRecord = await this.findById(entityName, id, { ...context, session: SYSTEM_SESSION })
    if (!existingRecord) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

    // Strip fields the caller cannot write before merge / access / default handling.
    data = filterWritableFields(entity, data, context?.session)

    // Check update access against the stored resource so owner and state rules
    // cannot be satisfied by values introduced in the patch itself.
    if (entity) {
      await assertEntityAccess({
        session: context?.session,
        action: 'update',
        entity,
        // Authorize the resource as it exists. Checking the proposed row lets a
        // caller satisfy an owner rule by changing userId in the same request.
        data: existingRecord,
        permissionManager: this.permissionManager,
        policyEvaluator: this.policyEvaluator,
      })
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
      this.assertTransactionActive()
      const updated = await (db as any)
        .update(table)
        .set(dbData)
        .where(whereClause)
        .returning()

      if (!updated?.[0]) {
        throw new Error(`Conflict: ${entityName} ${id} no longer matches the expected state`)
      }

      // Return updated record
      const after = filterReadableFields(entity, this.toCamelCase(updated[0]), context?.session)
      await this.recordChange(entityName, 'update', id)
      await this.mutationObserver?.({ entity: entityName, event: 'update', before: filterReadableFields(entity, existingRecord, context?.session), after, context })
      return after
    } finally {
      this.metrics?.recordQuery(entityName, 'update', performance.now() - start)
    }
  }

  /**
   * Delete a record
   */
  async delete(entityName: string, id: string, context?: QueryContext): Promise<void> {
    if ((this.mutationObserver || this.recordsLiveChanges) && !this.inTransaction) return this.transaction(() => this.delete(entityName, id, context))
    await this.waitForTransaction()
    const db = this.getDb()
    const table = this.connection.getTable(entityName)
    const entity = this.connection.getEntity(entityName)

    if (!table) {
      throw new Error(`Entity ${entityName} not found`)
    }

    const existingRecord = await this.findById(entityName, id, { ...context, session: SYSTEM_SESSION })
    if (!existingRecord) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

    // Check delete access
    if (entity) {
      await assertEntityAccess({
        session: context?.session,
        action: 'delete',
        entity,
        data: existingRecord,
        permissionManager: this.permissionManager,
        policyEvaluator: this.policyEvaluator,
      })
    }

    const start = performance.now()
    try {
      this.assertTransactionActive()
      await (db as any)
        .delete(table)
        .where(eq(table.id, id))
      await this.recordChange(entityName, 'delete', id)
      await this.mutationObserver?.({ entity: entityName, event: 'delete', before: filterReadableFields(entity, existingRecord, context?.session), context })
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
    if (!isSystemSession(context.session)
      && (requiresRecordEvaluation(entity?.access?.read)
        || this.permissionManager?.requiresRecordCheck(queryDef.entity, 'read') === true)) {
      return (await this.execute({ ...queryDef, limit: undefined, offset: undefined }, context)).length
    }
    if (entity) {
      await assertEntityAccess({
        session: context.session,
        action: 'read',
        entity,
        permissionManager: this.permissionManager,
        policyEvaluator: this.policyEvaluator,
      })
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
    const entity: Entity | undefined = targetEntity ? this.connection.getEntity(targetEntity) : undefined
    const allowedFields = entity ? new Set(entity.fields.map(field => field.name)) : undefined
    return this.compilePredicate(normalizeQueryWhere(where, context, { allowedFields }), table)
  }

  private compilePredicate(predicate: QueryPredicate | undefined, table: any): SQL | undefined {
    if (!predicate) return undefined
    if (predicate.kind === 'constant') return predicate.value ? sql`1 = 1` : sql`1 = 0`
    if (predicate.kind === 'group') {
      const conditions = predicate.predicates
        .map(child => this.compilePredicate(child, table))
        .filter((condition): condition is SQL => condition !== undefined)
      if (conditions.length === 0) {
        return predicate.operator === 'and' ? sql`1 = 1` : sql`1 = 0`
      }
      return predicate.operator === 'and' ? and(...conditions) : or(...conditions)
    }

    const column = table?.[predicate.field] ?? table?.[this.toSnakeCaseString(predicate.field)]
    if (!column) return undefined

    switch (predicate.operator) {
      case 'eq': return predicate.value === null ? isNull(column) : eq(column, predicate.value)
      case 'ne': return predicate.value === null ? isNotNull(column) : ne(column, predicate.value)
      case 'gt': return gt(column, predicate.value)
      case 'gte': return gte(column, predicate.value)
      case 'lt': return lt(column, predicate.value)
      case 'lte': return lte(column, predicate.value)
      case 'in': return Array.isArray(predicate.value) && predicate.value.length > 0
        ? inArray(column, predicate.value)
        : sql`1 = 0`
      case 'like': return like(column, String(predicate.value))
      case 'null': return predicate.value ? isNull(column) : isNotNull(column)
    }
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
