import type { UserSession } from '../auth/session.js'

export interface QueryValueContext {
  params?: Record<string, string>
  query?: Record<string, string>
  session?: UserSession | null
}

export type QueryComparisonOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'like'
  | 'null'

export type QueryPredicate =
  | { kind: 'constant'; value: boolean }
  | { kind: 'comparison'; field: string; operator: QueryComparisonOperator; value?: unknown }
  | { kind: 'group'; operator: 'and' | 'or'; predicates: QueryPredicate[] }

export interface QueryNormalizationOptions {
  allowedFields?: ReadonlySet<string>
}

const OPERATORS = new Set<QueryComparisonOperator>([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'null',
])

/** Resolve all placeholder forms accepted by Zebric runtimes. */
export function resolveQueryValue(value: unknown, context: QueryValueContext): unknown {
  if (typeof value !== 'string') return value

  if (value.startsWith('{') && value.endsWith('}')) {
    const key = value.slice(1, -1)
    return context.params?.[key]
      ?? context.query?.[key]
      ?? context.session?.user?.id
      ?? context.session?.userId
  }
  if (value.startsWith('$params.')) return context.params?.[value.slice(8)]
  if (value.startsWith('$query.')) return context.query?.[value.slice(7)]
  if (value.startsWith('$currentUser.')) return context.session?.user?.[value.slice(13)]

  return value
}

/** Convert blueprint where syntax into the canonical predicate tree compiled by each runtime. */
export function normalizeQueryWhere(
  where: Record<string, any> | undefined,
  context: QueryValueContext = {},
  options: QueryNormalizationOptions = {},
): QueryPredicate | undefined {
  if (!where) return undefined
  if (typeof where !== 'object' || Array.isArray(where)) {
    throw new Error('Query where clause must be an object')
  }
  if (where._impossible === true) return { kind: 'constant', value: false }

  const predicates: QueryPredicate[] = []

  for (const logicalOperator of ['and', 'or'] as const) {
    const branches = where[logicalOperator]
    if (!Array.isArray(branches)) continue
    predicates.push({
      kind: 'group',
      operator: logicalOperator,
      predicates: branches.map(branch => normalizeQueryWhere(branch, context, options)
        ?? { kind: 'constant', value: true }),
    })
  }

  for (const [field, expected] of Object.entries(where)) {
    if (field === 'and' || field === 'or' || field === 'entity' || field === '_impossible') continue
    if (options.allowedFields && !options.allowedFields.has(field)) {
      predicates.push({ kind: 'constant', value: false })
      continue
    }

    if (isOperatorRecord(expected)) {
      if (Object.keys(expected).length === 0) {
        throw new Error(`Query operator object for ${field} cannot be empty`)
      }
      for (const [rawOperator, rawValue] of Object.entries(expected)) {
        const operator = rawOperator.replace(/^\$/, '') as QueryComparisonOperator
        if (!OPERATORS.has(operator)) {
          throw new Error(`Unsupported query operator: ${rawOperator}`)
        }
        const value = resolveQueryValue(rawValue, context)
        predicates.push(value === undefined && operator !== 'null'
          ? { kind: 'constant', value: false }
          : { kind: 'comparison', field, operator, value })
      }
      continue
    }

    const value = resolveQueryValue(expected, context)
    predicates.push(value === undefined
      ? { kind: 'constant', value: false }
      : { kind: 'comparison', field, operator: 'eq', value })
  }

  if (predicates.length === 0) return undefined
  if (predicates.length === 1) return predicates[0]
  return { kind: 'group', operator: 'and', predicates }
}

export function matchesQueryPredicate(
  row: Record<string, any>,
  predicate: QueryPredicate | undefined,
): boolean {
  if (!predicate) return true
  if (predicate.kind === 'constant') return predicate.value
  if (predicate.kind === 'group') {
    return predicate.operator === 'and'
      ? predicate.predicates.every(child => matchesQueryPredicate(row, child))
      : predicate.predicates.some(child => matchesQueryPredicate(row, child))
  }

  const actual = row[predicate.field]
  const expected = predicate.value
  switch (predicate.operator) {
    case 'eq': return expected === null ? actual == null : actual === expected
    case 'ne': return expected === null ? actual != null : actual !== expected
    case 'gt': return actual > (expected as any)
    case 'gte': return actual >= (expected as any)
    case 'lt': return actual < (expected as any)
    case 'lte': return actual <= (expected as any)
    case 'in': return Array.isArray(expected) && expected.includes(actual)
    case 'like': return matchesLike(actual, expected)
    case 'null': return expected ? actual == null : actual != null
  }
}

function isOperatorRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function matchesLike(actual: unknown, pattern: unknown): boolean {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = escaped.replace(/%/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${expression}$`, 'i').test(String(actual ?? ''))
}
