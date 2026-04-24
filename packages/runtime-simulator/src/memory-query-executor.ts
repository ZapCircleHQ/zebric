import {
  AccessControl,
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

  constructor(
    private blueprint: Blueprint,
    seedData: SimulatorSeedData,
    private logger: SimulatorLogger
  ) {
    this.loadSeed(seedData)
  }

  setBlueprint(blueprint: Blueprint): void {
    this.blueprint = blueprint
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

    const hasAccess = await AccessControl.checkAccess({
      session: context.session,
      action: 'read',
      entity,
    })
    if (!hasAccess) {
      this.logger.log({
        type: 'query',
        message: `Read denied for ${query.entity}`,
        detail: { query },
      })
      return []
    }

    const accessFilter = AccessControl.getFilterConditions(entity, context.session)
    let result = rows.filter((row) => this.matchesWhere(row, query.where, context))
    if (accessFilter) {
      result = result.filter((row) => this.matchesWhere(row, accessFilter, context))
    }

    result = this.applyOrder(result, query.orderBy)

    const offset = query.offset ?? 0
    const limited = query.limit === undefined
      ? result.slice(offset)
      : result.slice(offset, offset + query.limit)

    const filtered = limited.map((row) => AccessControl.filterFields(entity, 'read', row, context.session))
    this.logger.log({
      type: 'query',
      message: `Read ${filtered.length} ${query.entity} record(s)`,
      detail: { query, context: this.safeContext(context) },
    })
    return filtered
  }

  async create(entityName: string, data: Record<string, any>, context: RequestContext): Promise<any> {
    const entity = this.getEntity(entityName)
    const writable = AccessControl.filterFields(entity, 'write', data, context.session)
    const record = this.applyDefaults(entity, writable, context)

    const hasAccess = await AccessControl.checkAccess({
      session: context.session,
      action: 'create',
      entity,
      data: record,
    })
    if (!hasAccess) {
      throw new Error(`Access denied: Cannot create ${entityName}`)
    }

    this.getRows(entityName).push(record)
    this.logger.log({
      type: 'mutation',
      message: `Created ${entityName} ${record.id ?? ''}`.trim(),
      detail: { record },
    })
    return { ...record }
  }

  async update(entityName: string, id: string, data: Record<string, any>, context: RequestContext): Promise<any> {
    const entity = this.getEntity(entityName)
    const rows = this.getRows(entityName)
    const index = rows.findIndex((row) => String(row.id) === String(id))
    if (index < 0) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

    const existing = rows[index]!
    const writable = AccessControl.filterFields(entity, 'write', data, context.session)
    const updated = { ...existing, ...this.coerceValues(entity, writable) }
    const hasAccess = await AccessControl.checkAccess({
      session: context.session,
      action: 'update',
      entity,
      data: updated,
    })
    if (!hasAccess) {
      throw new Error(`Access denied: Cannot update ${entityName}`)
    }

    rows[index] = updated
    this.logger.log({
      type: 'mutation',
      message: `Updated ${entityName} ${id}`,
      detail: { before: existing, after: updated },
    })
    return { ...updated }
  }

  async delete(entityName: string, id: string, context: RequestContext): Promise<any> {
    const entity = this.getEntity(entityName)
    const rows = this.getRows(entityName)
    const index = rows.findIndex((row) => String(row.id) === String(id))
    if (index < 0) {
      throw new Error(`${entityName} with id ${id} not found`)
    }

    const record = rows[index]!
    const hasAccess = await AccessControl.checkAccess({
      session: context.session,
      action: 'delete',
      entity,
      data: record,
    })
    if (!hasAccess) {
      throw new Error(`Access denied: Cannot delete ${entityName}`)
    }

    rows.splice(index, 1)
    this.logger.log({
      type: 'mutation',
      message: `Deleted ${entityName} ${id}`,
      detail: { record },
    })
  }

  async findById(entityName: string, id: string): Promise<any> {
    this.getEntity(entityName)
    const record = this.getRows(entityName).find((row) => String(row.id) === String(id))
    return record ? { ...record } : null
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

    const hasAccess = await AccessControl.checkAccess({
      session: context.session,
      action: 'read',
      entity,
    })
    if (!hasAccess) return []

    const trimmed = String(query ?? '').trim()
    if (!trimmed) return []

    const needle = trimmed.toLowerCase()
    const validFields = fields.filter((f) => entity.fields.some((ef) => ef.name === f))
    if (validFields.length === 0) return []

    let matches = rows.filter((row) =>
      validFields.some((field) => String(row[field] ?? '').toLowerCase().includes(needle))
    )

    if (options.filter) {
      matches = matches.filter((row) => this.matchesWhere(row, options.filter, context))
    }
    const accessFilter = AccessControl.getFilterConditions(entity, context.session)
    if (accessFilter) {
      matches = matches.filter((row) => this.matchesWhere(row, accessFilter, context))
    }

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)
    return matches
      .slice(0, limit)
      .map((row) => AccessControl.filterFields(entity, 'read', row, context.session))
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

  private matchesWhere(row: Record<string, any>, where: Record<string, any> | undefined, context: RequestContext): boolean {
    if (!where) return true

    if (Array.isArray((where as any).or)) {
      return (where as any).or.some((condition: Record<string, any>) => this.matchesWhere(row, condition, context))
    }

    if (Array.isArray((where as any).and)) {
      return (where as any).and.every((condition: Record<string, any>) => this.matchesWhere(row, condition, context))
    }

    for (const [field, expected] of Object.entries(where)) {
      if (!this.matchesField(row[field], this.resolveValue(expected, context))) {
        return false
      }
    }
    return true
  }

  private matchesField(actual: any, expected: any): boolean {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      for (const [op, value] of Object.entries(expected)) {
        if (!this.matchesOperator(actual, op, value)) {
          return false
        }
      }
      return true
    }
    return actual === expected
  }

  private matchesOperator(actual: any, op: string, value: any): boolean {
    switch (op) {
      case '$eq':
        return actual === value
      case '$ne':
        return actual !== value
      case '$gt':
        return actual > value
      case '$gte':
        return actual >= value
      case '$lt':
        return actual < value
      case '$lte':
        return actual <= value
      case '$in':
        return Array.isArray(value) && value.includes(actual)
      case '$like':
        return String(actual ?? '').includes(String(value).replace(/%/g, ''))
      case '$null':
        return value ? actual == null : actual != null
      default:
        return actual === value
    }
  }

  private resolveValue(value: any, context: RequestContext): any {
    if (typeof value !== 'string') {
      return value
    }
    if (value.startsWith('{') && value.endsWith('}')) {
      const key = value.slice(1, -1)
      return context.params?.[key] ?? context.query?.[key] ?? context.session?.user?.id
    }
    if (value === '$currentUser.id') {
      return context.session?.user?.id
    }
    if (value.startsWith('$currentUser.')) {
      return context.session?.user?.[value.slice(13)]
    }
    return value
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
