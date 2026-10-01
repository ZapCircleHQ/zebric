import type { Actor } from '../auth/actor.js'
import { actorFromSession } from '../auth/actor.js'
import { SYSTEM_SESSION, type UserSession } from '../auth/provider.js'
import type { QueryExecutorPort } from '../routing/request-ports.js'
import type { AccessCondition, Blueprint, Entity, Relation } from '../types/blueprint.js'
import { ExpressionEvaluationError } from '../errors/domain-errors.js'
import { canExpressionBeTrueWithoutInput, evaluateExpression, expressionPaths, validateExpression } from './expression.js'

const SHORTHANDS = new Set(['public', 'authenticated', 'owner'])

export interface PolicyContext {
  actor?: Actor | null
  session?: UserSession | null
  record?: Record<string, unknown>
  input?: Record<string, unknown>
  workflow?: Record<string, unknown>
  entity?: Entity | string
  now?: Date
}

export class PolicyEvaluator {
  constructor(
    private readonly blueprint?: Blueprint,
    private readonly queryExecutor?: QueryExecutorPort,
  ) {}

  async evaluate(condition: AccessCondition | undefined, context: PolicyContext): Promise<boolean> {
    if (condition === undefined) return true
    const actor = context.actor ?? actorFromSession(context.session)

    if (typeof condition === 'boolean') return condition
    if (typeof condition === 'string') {
      if (condition === 'public') return true
      if (condition === 'authenticated') return actor != null
      if (condition === 'owner') {
        return context.record?.userId === effectiveActorId(actor)
      }
      const record = context.record
        ? await this.hydrateRelations(condition, context.record, context.entity)
        : undefined
      return evaluateExpression(condition, expressionContext(actor, { ...context, record })) === true
    }

    if ('and' in condition && Array.isArray(condition.and)) {
      if (condition.and.length === 0) return false
      for (const branch of condition.and) {
        if (!await this.evaluate(branch, context)) return false
      }
      return true
    }
    if ('or' in condition && Array.isArray(condition.or)) {
      for (const branch of condition.or) {
        if (await this.evaluate(branch, context)) return true
      }
      return false
    }

    const entries = Object.entries(condition)
    if (entries.length === 0) return false
    return entries.every(([path, expected]) => {
      const actual = resolveLegacyPath(path, actor, context)
      const resolvedExpected = resolveLegacyValue(expected, actor, context)
      return actual !== undefined && resolvedExpected !== undefined && actual === resolvedExpected
    })
  }

  /** Evaluate the input-independent portion of a condition while listing a command. */
  async evaluateForListing(condition: AccessCondition | undefined, context: PolicyContext): Promise<boolean> {
    if (!requiresInputEvaluation(condition)) return this.evaluate(condition, context)
    if (typeof condition === 'string') {
      const record = context.record
        ? await this.hydrateRelations(condition, context.record, context.entity)
        : undefined
      return canExpressionBeTrueWithoutInput(condition, expressionContext(
        context.actor ?? actorFromSession(context.session),
        { ...context, record },
      ))
    }
    if (condition && typeof condition === 'object' && 'and' in condition && Array.isArray(condition.and)) {
      for (const branch of condition.and) if (!await this.evaluateForListing(branch, context)) return false
      return condition.and.length > 0
    }
    if (condition && typeof condition === 'object' && 'or' in condition && Array.isArray(condition.or)) {
      for (const branch of condition.or) if (await this.evaluateForListing(branch, context)) return true
      return false
    }
    if (condition && typeof condition === 'object') {
      const knownEntries = Object.entries(condition).filter(([path, value]) =>
        !path.startsWith('input.') && !(typeof value === 'string' && value.startsWith('input.'))
      )
      return knownEntries.length === 0 || this.evaluate(Object.fromEntries(knownEntries), context)
    }
    return true
  }

  private async hydrateRelations(
    expression: string,
    record: Record<string, unknown>,
    entityReference?: Entity | string,
  ): Promise<Record<string, unknown>> {
    if (!this.blueprint || !this.queryExecutor || !entityReference) return record
    const entity = typeof entityReference === 'string'
      ? this.blueprint.entities.find(candidate => candidate.name === entityReference)
      : entityReference
    if (!entity) return record

    const hydrated = { ...record }
    const paths = expressionPaths(expression)
      .filter(path => path.startsWith('record.'))
      .map(path => path.slice(7).split('.'))
    for (const path of paths) await this.hydratePath(hydrated, entity, path)
    return hydrated
  }

  private async hydratePath(
    value: Record<string, unknown> | Record<string, unknown>[],
    entity: Entity,
    path: string[],
  ): Promise<void> {
    const [part, ...remaining] = path
    if (!part) return
    if (Array.isArray(value)) {
      await Promise.all(value.map(item => this.hydratePath(item, entity, path)))
      return
    }

    const relation = entity.relations?.[part]
    if (!relation) return
    const relatedEntity = this.blueprint?.entities.find(candidate => candidate.name === relation.entity)
    if (!relatedEntity) return

    if (!Object.prototype.hasOwnProperty.call(value, part)) {
      value[part] = await this.loadRelation(value, relation)
    }
    if (remaining.length === 0 || value[part] == null) return
    const related = value[part]
    if (Array.isArray(related)) {
      await Promise.all(related
        .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
        .map(item => this.hydratePath(item, relatedEntity, remaining)))
    } else if (typeof related === 'object') {
      await this.hydratePath(related as Record<string, unknown>, relatedEntity, remaining)
    }
  }

  private async loadRelation(
    record: Record<string, unknown>,
    relation: Relation,
  ): Promise<Record<string, unknown> | Record<string, unknown>[] | null> {
    if (!this.queryExecutor) return relation.type === 'hasMany' ? [] : null
    if (relation.type === 'manyToMany') {
      throw new ExpressionEvaluationError('manyToMany policy traversal requires an explicit join relation', {
        relation: relation.entity,
      })
    }
    if (!relation.foreign_key) {
      throw new ExpressionEvaluationError(`Relation to ${relation.entity} has no foreign_key`)
    }
    if (relation.type === 'belongsTo') {
      const relatedId = record[relation.foreign_key]
      if (typeof relatedId !== 'string') return null
      return this.queryExecutor.findById(relation.entity, relatedId, { session: SYSTEM_SESSION })
    }

    const id = record.id
    if (typeof id !== 'string') return relation.type === 'hasMany' ? [] : null
    const rows = await this.queryExecutor.execute({
      entity: relation.entity,
      where: { [relation.foreign_key]: id },
      limit: relation.type === 'hasOne' ? 1 : undefined,
    }, { session: SYSTEM_SESSION }) as Record<string, unknown>[]
    return relation.type === 'hasOne' ? rows[0] ?? null : rows
  }
}

export function validatePolicyCondition(condition: AccessCondition | undefined): void {
  if (condition == null || typeof condition === 'boolean') return
  if (typeof condition === 'string') {
    if (!SHORTHANDS.has(condition)) validateExpression(condition)
    return
  }
  if ('and' in condition && Array.isArray(condition.and)) {
    condition.and.forEach(validatePolicyCondition)
  } else if ('or' in condition && Array.isArray(condition.or)) {
    condition.or.forEach(validatePolicyCondition)
  }
}

export function requiresRecordEvaluation(condition: AccessCondition | undefined): boolean {
  if (typeof condition === 'string') return !SHORTHANDS.has(condition)
  if (!condition || typeof condition === 'boolean') return false
  if ('and' in condition && Array.isArray(condition.and)) {
    return condition.and.some(requiresRecordEvaluation)
  }
  if ('or' in condition && Array.isArray(condition.or)) {
    return condition.or.some(requiresRecordEvaluation)
  }
  return Object.keys(condition).some(key => !key.startsWith('$currentUser.'))
}

/** Whether a condition needs submitted command input and cannot be decided while listing actions. */
export function requiresInputEvaluation(condition: AccessCondition | undefined): boolean {
  if (typeof condition === 'string') {
    return !SHORTHANDS.has(condition) && expressionPaths(condition).some(path => path.startsWith('input.'))
  }
  if (!condition || typeof condition === 'boolean') return false
  if ('and' in condition && Array.isArray(condition.and)) {
    return condition.and.some(requiresInputEvaluation)
  }
  if ('or' in condition && Array.isArray(condition.or)) {
    return condition.or.some(requiresInputEvaluation)
  }
  return Object.entries(condition).some(([path, value]) =>
    path.startsWith('input.') || (typeof value === 'string' && value.startsWith('input.'))
  )
}

function expressionContext(actor: Actor | null, context: PolicyContext) {
  const actorValue = actor ? {
    ...actor,
    effectiveId: effectiveActorId(actor),
  } : undefined
  return {
    actor: actorValue,
    record: context.record,
    input: context.input,
    workflow: context.workflow,
    now: context.now,
  }
}

function effectiveActorId(actor?: Actor | null): string | undefined {
  return actor?.delegatedBy ?? actor?.id
}

function resolveLegacyPath(path: string, actor: Actor | null, context: PolicyContext): unknown {
  if (path.startsWith('$currentUser.')) {
    const key = path.slice(13)
    if (key === 'id') return effectiveActorId(actor)
    return context.session?.user?.[key] ?? actor?.metadata?.[key]
  }
  if (path.startsWith('actor.')) return getPath(expressionContext(actor, context).actor, path.slice(6))
  if (path.startsWith('record.')) return getPath(context.record, path.slice(7))
  if (path.startsWith('input.')) return getPath(context.input, path.slice(6))
  return getPath(context.record, path)
}

function resolveLegacyValue(value: unknown, actor: Actor | null, context: PolicyContext): unknown {
  return typeof value === 'string' && (
    value.startsWith('$currentUser.')
    || value.startsWith('actor.')
    || value.startsWith('record.')
    || value.startsWith('input.')
  ) ? resolveLegacyPath(value, actor, context) : value
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current == null || typeof current !== 'object') return undefined
    if (part === '__proto__' || part === 'prototype' || part === 'constructor') return undefined
    return Object.prototype.hasOwnProperty.call(current, part)
      ? (current as Record<string, unknown>)[part]
      : undefined
  }, value)
}
