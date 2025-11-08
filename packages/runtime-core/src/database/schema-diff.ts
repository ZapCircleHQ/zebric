/**
 * Schema Differ
 *
 * Computes conservative diffs between two Blueprint schemas.
 * This is scaffolding for a migration system – it does not apply migrations,
 * but it lets the engine detect structural changes and react accordingly.
 */

import type { Blueprint, Entity, Field } from '../types/blueprint.js'

export interface EntityFieldChange {
  entity: string
  field: Field
}

export interface EntityFieldModification {
  entity: string
  field: {
    name: string
    before: Field
    after: Field
  }
}

export interface SchemaDiffResult {
  entitiesAdded: Entity[]
  entitiesRemoved: Entity[]
  fieldsAdded: EntityFieldChange[]
  fieldsRemoved: EntityFieldChange[]
  fieldsChanged: EntityFieldModification[]
  hasBreakingChanges: boolean
  hasChanges: boolean
}

export class SchemaDiffer {
  static diff(previous: Blueprint | undefined, next: Blueprint): SchemaDiffResult {
    if (!previous) {
      return {
        entitiesAdded: next.entities,
        entitiesRemoved: [],
        fieldsAdded: [],
        fieldsRemoved: [],
        fieldsChanged: [],
        hasBreakingChanges: false,
        hasChanges: next.entities.length > 0,
      }
    }

    const prevEntities = new Map(previous.entities.map((entity) => [entity.name, entity]))
    const nextEntities = new Map(next.entities.map((entity) => [entity.name, entity]))

    const entitiesAdded: Entity[] = []
    const entitiesRemoved: Entity[] = []
    const fieldsAdded: EntityFieldChange[] = []
    const fieldsRemoved: EntityFieldChange[] = []
    const fieldsChanged: EntityFieldModification[] = []

    // Detect added entities
    for (const entity of next.entities) {
      if (!prevEntities.has(entity.name)) {
        entitiesAdded.push(entity)
      }
    }

    // Detect removed entities
    for (const entity of previous.entities) {
      if (!nextEntities.has(entity.name)) {
        entitiesRemoved.push(entity)
      }
    }

    // Field-level comparisons for common entities
    for (const entity of next.entities) {
      const prevEntity = prevEntities.get(entity.name)
      if (!prevEntity) {
        continue
      }

      const prevFields = new Map(prevEntity.fields.map((field) => [field.name, field]))
      const nextFields = new Map(entity.fields.map((field) => [field.name, field]))

      for (const field of entity.fields) {
        if (!prevFields.has(field.name)) {
          fieldsAdded.push({ entity: entity.name, field })
        } else {
          const previousField = prevFields.get(field.name)!
          if (!SchemaDiffer.fieldsEqual(previousField, field)) {
            fieldsChanged.push({
              entity: entity.name,
              field: {
                name: field.name,
                before: previousField,
                after: field,
              },
            })
          }
        }
      }

      for (const field of prevEntity.fields) {
        if (!nextFields.has(field.name)) {
          fieldsRemoved.push({ entity: entity.name, field })
        }
      }
    }

    const hasBreakingChanges =
      entitiesRemoved.length > 0 ||
      fieldsRemoved.length > 0 ||
      fieldsChanged.some((change) => SchemaDiffer.isBreakingFieldChange(change.field.before, change.field.after))

    const hasChanges =
      entitiesAdded.length > 0 ||
      entitiesRemoved.length > 0 ||
      fieldsAdded.length > 0 ||
      fieldsRemoved.length > 0 ||
      fieldsChanged.length > 0

    return {
      entitiesAdded,
      entitiesRemoved,
      fieldsAdded,
      fieldsRemoved,
      fieldsChanged,
      hasBreakingChanges,
      hasChanges,
    }
  }

  private static fieldsEqual(a: Field, b: Field): boolean {
    return (
      a.name === b.name &&
      a.type === b.type &&
      a.primary_key === b.primary_key &&
      a.required === b.required &&
      a.nullable === b.nullable &&
      a.unique === b.unique &&
      a.default === b.default &&
      a.ref === b.ref &&
      SchemaDiffer.enumValuesEqual(a.values, b.values)
    )
  }

  private static enumValuesEqual(a?: string[], b?: string[]): boolean {
    if (!a && !b) return true
    if (!a || !b) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  private static isBreakingFieldChange(before: Field, after: Field): boolean {
    if (before.type !== after.type) {
      return true
    }

    if (before.required && !after.required) {
      return false
    }

    if (!before.required && after.required) {
      return true
    }

    if (!before.nullable && after.nullable) {
      return false
    }

    if (before.nullable && !after.nullable) {
      return true
    }

    if (before.default !== after.default) {
      return true
    }

    return false
  }
}
