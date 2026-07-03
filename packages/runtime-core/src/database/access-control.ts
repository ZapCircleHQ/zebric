/**
 * Access Control
 *
 * Implements row-level security and field-level access control based on Blueprint access rules.
 */

import type { Entity, AccessCondition, Field } from '../types/blueprint.js'
import type { UserSession, PermissionManager } from '../auth/index.js'

export interface AccessContext {
  session?: UserSession | null
  action: 'read' | 'create' | 'update' | 'delete'
  entity: Entity
  data?: Record<string, any>
  permissionManager?: PermissionManager
}

export class AccessControl {
  /**
   * Check if the user has access to perform an action on an entity
   * This checks both permissions (RBAC) and entity access rules
   */
  static async checkAccess(context: AccessContext): Promise<boolean> {
    const { session, action, entity, data, permissionManager } = context

    // Step 1: Check permissions (RBAC) if permission manager is available
    if (permissionManager) {
      const hasPermission = await permissionManager.checkPermission({
        session,
        entity: entity.name,
        action,
        data,
      })

      // If permissions deny access, reject immediately
      if (!hasPermission) {
        return false
      }
    }

    // Step 2: Check entity-level access rules
    // If no access rules defined, allow access (permissions already checked)
    if (!entity.access) {
      return true
    }

    const condition = entity.access[action]

    // If no condition for this action, allow access
    if (condition === undefined) {
      return true
    }

    // For read operations without specific data, allow access if we can apply row-level filters
    // This lets the query executor filter results based on the access conditions
    if (action === 'read' && !data) {
      // If we can generate filter conditions, allow the query to proceed
      // The actual filtering will happen at the SQL level
      const filters = this.getFilterConditions(entity, session)
      if (this.isImpossibleFilter(filters)) {
        return false
      }
      if (filters !== null) {
        return true
      }
    }

    return this.evaluateCondition(condition, session, data)
  }

  /**
   * Get filter conditions to apply for row-level security
   */
  static getFilterConditions(
    entity: Entity,
    session?: UserSession | null
  ): Record<string, any> | null {
    if (!entity.access?.read) {
      return null
    }

    return this.conditionToFilter(entity.access.read, session)
  }

  static isImpossibleFilter(filter: Record<string, any> | null): boolean {
    return filter?._impossible === true
  }

  private static conditionToFilter(
    condition: AccessCondition,
    session?: UserSession | null
  ): Record<string, any> | null {
    if (typeof condition === 'boolean') {
      return condition ? null : { _impossible: true }
    }

    if (typeof condition === 'string') {
      switch (condition) {
        case 'public':
          return null
        case 'authenticated':
          return session?.user ? null : { _impossible: true }
        case 'owner':
          return session?.user?.id
            ? { userId: session.user.id }
            : { _impossible: true }
        default:
          return { _impossible: true }
      }
    }

    if ('or' in condition && Array.isArray(condition.or)) {
      const branches = condition.or.map(c => this.conditionToFilter(c, session))
      if (branches.some(branch => branch === null)) {
        return null
      }
      const possible = branches.filter(branch => !this.isImpossibleFilter(branch)) as Record<string, any>[]
      if (possible.length === 0) return { _impossible: true }
      if (possible.length === 1) return possible[0] ?? { _impossible: true }
      return { or: possible }
    }

    if ('and' in condition && Array.isArray(condition.and)) {
      const branches = condition.and.map(c => this.conditionToFilter(c, session))
      if (branches.some(branch => this.isImpossibleFilter(branch))) {
        return { _impossible: true }
      }
      const required = branches.filter(branch => branch !== null) as Record<string, any>[]
      if (required.length === 0) return null
      if (required.length === 1) return required[0] ?? null
      return { and: required }
    }

    const rowFilter: Record<string, any> = {}
    for (const [key, value] of Object.entries(condition)) {
      if (key.startsWith('$currentUser.')) {
        if (!this.evaluateCondition({ [key]: value }, session)) {
          return { _impossible: true }
        }
        continue
      }
      const resolved = this.resolveValue(value, session)
      if (resolved === undefined) {
        return { _impossible: true }
      }
      rowFilter[key] = resolved
    }

    return Object.keys(rowFilter).length > 0 ? rowFilter : null
  }

  /**
   * Evaluate an access condition
   */
  private static evaluateCondition(
    condition: AccessCondition,
    session?: UserSession | null,
    data?: Record<string, any>
  ): boolean {
    // Boolean condition
    if (typeof condition === 'boolean') {
      return condition
    }

    // String shorthand conditions (e.g., "public", "authenticated", "owner")
    if (typeof condition === 'string') {
      switch (condition) {
        case 'public':
          return true
        case 'authenticated':
          return !!session?.user
        case 'owner':
          if (!session?.user?.id || !data) return false
          return data.userId === session.user.id
        default:
          return false
      }
    }

    // AND condition
    if ('and' in condition && Array.isArray(condition.and)) {
      return condition.and.every(c => this.evaluateCondition(c, session, data))
    }

    // OR condition
    if ('or' in condition && Array.isArray(condition.or)) {
      return condition.or.some(c => this.evaluateCondition(c, session, data))
    }

    // Object condition - check if all fields match
    if (typeof condition === 'object') {
      for (const [key, value] of Object.entries(condition)) {
        // Check if the key itself is a session variable reference
        if (key.startsWith('$currentUser.')) {
          const sessionKey = key.substring(13)
          const sessionValue = session?.user?.[sessionKey]
          const expectedValue = this.resolveValue(value, session)

          if (sessionValue !== expectedValue) {
            return false
          }
        } else {
          // Normal data field comparison
          const actualValue = this.resolveValue(value, session)
          const dataValue = data?.[key]

          if (dataValue !== actualValue) {
            return false
          }
        }
      }
      return true
    }

    return false
  }

  /**
   * Resolve a value, substituting session placeholders
   */
  private static resolveValue(value: any, session?: UserSession | null): any {
    if (typeof value === 'string') {
      if (value === '$currentUser.id') {
        return session?.user?.id
      }
      if (value.startsWith('$currentUser.')) {
        const key = value.substring(13)
        return session?.user?.[key]
      }
    }
    return value
  }

  /**
   * Filter fields based on field-level access control
   * Returns list of field names that the user can access
   */
  static getAccessibleFields(
    entity: Entity,
    action: 'read' | 'write',
    session?: UserSession | null,
    data?: Record<string, any>
  ): string[] {
    const accessibleFields: string[] = []

    for (const field of entity.fields) {
      const canAccess = this.canAccessField(field, action, session, data)
      if (canAccess) {
        accessibleFields.push(field.name)
      }
    }

    return accessibleFields
  }

  /**
   * Check if user can access a specific field
   */
  static canAccessField(
    field: Field,
    action: 'read' | 'write',
    session?: UserSession | null,
    data?: Record<string, any>
  ): boolean {
    // If no field-level access rules, allow access
    if (!field.access) {
      return true
    }

    const condition = field.access[action]

    // If no condition for this action, check for fallback behavior
    if (condition === undefined) {
      // For write access: if read access is restricted, write should be at least as restrictive
      // This prevents the security issue where users can write data they can't read
      if (action === 'write' && field.access.read !== undefined) {
        // Check if user can read the field - if not, they can't write it either
        return this.canAccessField(field, 'read', session, data)
      }
      // Otherwise, allow access
      return true
    }

    // Evaluate the condition
    const result = this.evaluateCondition(condition, session, data)
    return result
  }

  /**
   * Filter data object to only include accessible fields
   */
  static filterFields(
    entity: Entity,
    action: 'read' | 'write',
    data: Record<string, any>,
    session?: UserSession | null
  ): Record<string, any> {
    const accessibleFields = this.getAccessibleFields(entity, action, session, data)
    const filtered: Record<string, any> = {}

    for (const fieldName of accessibleFields) {
      if (Object.prototype.hasOwnProperty.call(data, fieldName)) {
        filtered[fieldName] = data[fieldName]
      }
    }

    return filtered
  }

  /**
   * Filter an array of data objects to only include accessible fields
   */
  static filterFieldsArray(
    entity: Entity,
    action: 'read' | 'write',
    dataArray: Record<string, any>[],
    session?: UserSession | null
  ): Record<string, any>[] {
    return dataArray.map(data => this.filterFields(entity, action, data, session))
  }
}
