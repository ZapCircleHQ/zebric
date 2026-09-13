import {
  AccessControl,
  PermissionManager,
  assertEntityAccess,
  filterReadableFields,
  filterWritableFields,
  matchesQueryPredicate,
  normalizeQueryWhere,
  type Blueprint,
  type Entity,
  type Query,
  type QueryExecutorPort,
  type RequestContext,
} from '@zebric/runtime-core'
import { createRecordId } from './id.js'
import type { SimulatorLogger } from './logger.js'
import type { SimulatorSeedData } from './types.js'

export class BrowserMemoryQueryExecutor implements QueryExecutorPort {
  private tables = new Map<string, Array<Record<string, any>>>()
  private permissionManager: PermissionManager

  constructor(
    private blueprint: Blueprint,
    seedData: SimulatorSeedData,
    private logger: SimulatorLogger
  ) {
    this.permissionManager = new PermissionManager(blueprint.auth)
    this.loadSeed(seedData)
  }

  setBlueprint(blueprint: Blueprint): void {
    this.blueprint = blueprint
    this.permissionManager = new PermissionManager(blueprint.auth)
    for (const entity of blueprint.entities) {
      if (!this.tables.has(entity.name)) {
        this.tables.set(entity.name, [])
      }
    }
  }

  loadSeed(seedData: SimulatorSeedData): void {
    this.tables.clear()
    const entityNames = new Set(this.blueprint.entities.map((entity) => entity.name))

    for (const entityName of Object.keys(seedData)) {
      if (!entityNames.has(entityName)) {
        this.logger.log({
          type: 'error',
          message: `Seed includes unknown entity "${entityName}"`,
          detail: { entityName },
        })
      }
    }

    for (const entity of this.blueprint.entities) {
      const rows = seedData[entity.name] || []
      const fieldNames = new Set(entity.fields.map((field) => field.name))
      for (const row of rows) {
        for (const fieldName of Object.keys(row)) {
          if (!fieldNames.has(fieldName)) {
            this.logger.log({
              type: 'error',
              message: `Seed for ${entity.name} includes unknown field "${fieldName}"`,
              detail: { entity: entity.name, fieldName, row },
            })
          }
        }
      }
      this.tables.set(entity.name, rows.map((row) => ({ ...row })))
    }
  }

  exportData(): SimulatorSeedData {
    const data: SimulatorSeedData = {}
    for (const [entity, rows] of this.tables) {
      data[entity] = rows.map((row) => ({ ...row }))
    }
    return data
  }

  async execute(query: Query, context: RequestContext): Promise<any> {
    const entity = this.getEntity(query.entity)
    const rows = this.getRows(query.entity)

    await assertEntityAccess({
      session: context.session,
      action: 'read',
      entity,
      permissionManager: this.permissionManager,
    })

    const accessFilter = AccessControl.getFilterConditions(entity, context.session)
    const allowedFields = new Set(entity.fields.map(field => field.name))
    const predicate = normalizeQueryWhere(query.where, context, { allowedFields })
    let result = rows.filter((row) => matchesQueryPredicate(row, predicate))
    if (accessFilter) {
      const accessPredicate = normalizeQueryWhere(accessFilter, context, { allowedFields })
      result = result.filter((row) => matchesQueryPredicate(row, accessPredicate))
    }

    result = this.applyOrder(result, query.orderBy)

    const offset = query.offset ?? 0
    const limited = query.limit === undefined
      ? result.slice(offset)
      : result.slice(offset, offset + query.limit)

    const filtered = limited.map((row) => filterReadableFields(entity, row, context.session))
    this.logger.log({
      type: 'query',
      message: `Read ${filtered.length} ${query.entity} record(s)`,
      detail: { query, context: this.safeContext(context) },
    })
    return filtered
  }

  async create(entityName: string, data: Record<string, any>, context: RequestContext): Promise<any> {
    const entity = this.getEntity(entityName)
    const writable = filterWritableFields(entity, data, context.session)
    const record = this.applyDefaults(entity, writable, context)

    await assertEntityAccess({
      session: context.session,
      action: 'create',
      entity,
      data: record,
      permissionManager: this.permissionManager,
    })

    this.getRows(entityName).push(record)
    this.logger.log({
      type: 'mutation',
      message: `Created ${entityName} ${record.id ?? ''}`.trim(),
      detail: { record },
    })
    return filterReadableFields(entity, { ...record }, context.session)
  }

  async update(entityName: string, id: string, data: Record<string, any>, context: RequestContext): Promise<any> {
    const entity = this.getEntity(entityName)
    const rows = this.getRows(entityName)
    const index = rows.findIndex((row) => String(row.id) === String(id))
    if (index < 0) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

    const existing = rows[index]!
    const writable = filterWritableFields(entity, data, context.session)
    await assertEntityAccess({
      session: context.session,
      action: 'update',
      entity,
      data: existing,
      permissionManager: this.permissionManager,
    })
    const updated = { ...existing, ...this.coerceValues(entity, writable) }

    rows[index] = updated
    this.logger.log({
      type: 'mutation',
      message: `Updated ${entityName} ${id}`,
      detail: { before: existing, after: updated },
    })
    return filterReadableFields(entity, { ...updated }, context.session)
  }

  async delete(entityName: string, id: string, context: RequestContext): Promise<any> {
    const entity = this.getEntity(entityName)
    const rows = this.getRows(entityName)
    const index = rows.findIndex((row) => String(row.id) === String(id))
    if (index < 0) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

    const record = rows[index]!
    await assertEntityAccess({
      session: context.session,
      action: 'delete',
      entity,
      data: record,
      permissionManager: this.permissionManager,
    })

    rows.splice(index, 1)
    this.logger.log({
      type: 'mutation',
      message: `Deleted ${entityName} ${id}`,
      detail: { record },
    })
  }

  async findById(entityName: string, id: string, context: RequestContext = {}): Promise<any> {
    const rows = await this.execute({ entity: entityName, where: { id }, limit: 1 }, context)
    return rows[0] ?? null
  }

  async search(
    entityName: string,
    fields: string[],
    query: string,
    options: { limit?: number; filter?: Record<string, any>; context?: RequestContext } = {}
  ): Promise<any[]> {
    const entity = this.getEntity(entityName)
    const rows = this.getRows(entityName)
    const context = options.context || {}

    await assertEntityAccess({
      session: context.session,
      action: 'read',
      entity,
      permissionManager: this.permissionManager,
    })

    const trimmed = String(query ?? '').trim()
    if (!trimmed) return []

    const needle = trimmed.toLowerCase()
    const validFields = fields.filter((f) => entity.fields.some((ef) => ef.name === f))
    if (validFields.length === 0) return []

    let matches = rows.filter((row) =>
      validFields.some((field) => String(row[field] ?? '').toLowerCase().includes(needle))
    )

    if (options.filter) {
      const predicate = normalizeQueryWhere(
        options.filter,
        context,
        { allowedFields: new Set(entity.fields.map(field => field.name)) },
      )
      matches = matches.filter((row) => matchesQueryPredicate(row, predicate))
    }
    const accessFilter = AccessControl.getFilterConditions(entity, context.session)
    if (accessFilter) {
      const accessPredicate = normalizeQueryWhere(
        accessFilter,
        context,
        { allowedFields: new Set(entity.fields.map(field => field.name)) },
      )
      matches = matches.filter((row) => matchesQueryPredicate(row, accessPredicate))
    }

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)
    return matches
      .slice(0, limit)
      .map((row) => filterReadableFields(entity, row, context.session))
  }

  private getEntity(name: string): Entity {
    const entity = this.blueprint.entities.find((candidate) => candidate.name === name)
    if (!entity) {
      throw new Error(`Entity not found: ${name}`)
    }
    return entity
  }

  private getRows(entityName: string): Array<Record<string, any>> {
    const rows = this.tables.get(entityName)
    if (!rows) {
      throw new Error(`Entity not found: ${entityName}`)
    }
    return rows
  }

  private applyDefaults(entity: Entity, data: Record<string, any>, context: RequestContext): Record<string, any> {
    const record = this.coerceValues(entity, data)

    for (const field of entity.fields) {
      if (record[field.name] === undefined && field.default !== undefined) {
        record[field.name] = typeof field.default === 'function' ? field.default() : field.default
      }
      if (record[field.name] === undefined && field.primary_key) {
        record[field.name] = createRecordId()
      }
      if (record[field.name] === undefined && field.name === 'id') {
        record[field.name] = createRecordId()
      }
      if (
        record[field.name] === undefined &&
        field.type === 'Ref' &&
        field.ref === 'User.id' &&
        context.session?.user?.id
      ) {
        record[field.name] = context.session.user.id
      }
    }

    return record
  }

  private coerceValues(entity: Entity, data: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}
    for (const field of entity.fields) {
      if (data[field.name] === undefined) continue
      const value = data[field.name]
      switch (field.type) {
        case 'Integer':
          result[field.name] = value === '' || value === null ? null : Number.parseInt(String(value), 10)
          break
        case 'Float':
          result[field.name] = value === '' || value === null ? null : Number.parseFloat(String(value))
          break
        case 'Boolean':
          result[field.name] = value === true || value === 'true' || value === 'on' || value === '1'
          break
        case 'JSON':
          if (typeof value === 'string') {
            try {
              result[field.name] = JSON.parse(value)
            } catch {
              result[field.name] = value
            }
          } else {
            result[field.name] = value
          }
          break
        default:
          result[field.name] = value
      }
    }
    return result
  }

  private applyOrder(rows: Array<Record<string, any>>, orderBy?: Record<string, 'asc' | 'desc'>): Array<Record<string, any>> {
    if (!orderBy) {
      return [...rows]
    }
    const entries = Object.entries(orderBy)
    return [...rows].sort((left, right) => {
      for (const [field, direction] of entries) {
        if (left[field] === right[field]) continue
        const result = left[field] > right[field] ? 1 : -1
        return direction === 'desc' ? -result : result
      }
      return 0
    })
  }

  private safeContext(context: RequestContext): Record<string, unknown> {
    return {
      params: context.params,
      query: context.query,
      userId: context.session?.user?.id,
    }
  }
}
