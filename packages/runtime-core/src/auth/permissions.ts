/**
 * Permission System
 *
 * Implements Role-Based Access Control (RBAC) based on Blueprint permissions.
 */

import type { AuthConfig, PermissionRule, PermissionCondition, AccessCondition } from '../types/blueprint.js'
import type { UserSession } from './session.js'

export interface PermissionCheckContext {
  session?: UserSession | null
  entity: string
  action: 'read' | 'create' | 'update' | 'delete'
  data?: Record<string, any>
}

export class PermissionManager {
  private permissions: Record<string, PermissionRule>

  constructor(authConfig?: AuthConfig) {
    this.permissions = authConfig?.permissions || {}
  }

  /**
   * Check if user has permission to perform an action
   */
  async checkPermission(context: PermissionCheckContext): Promise<boolean> {
    const { session } = context

    // If no permissions are configured at all, allow access (defer to entity-level rules)
    if (Object.keys(this.permissions).length === 0) {
      return true
    }

    // If no session, deny access (unless explicitly allowed for anonymous)
    if (!session?.user) {
      return this.checkAnonymousPermission(context)
    }

    // Get user roles
    const roles = this.getUserRoles(session)

    // If no roles and no anonymous permissions, deny
    if (roles.length === 0) {
      return this.checkAnonymousPermission(context)
    }

    // Check each role's permissions
    for (const role of roles) {
      const hasPermission = await this.checkRolePermission(role, context)
      if (hasPermission) {
        return true
      }
    }

    return false
  }

  /**
   * Check if a specific role has permission
   */
  private async checkRolePermission(
    role: string,
    context: PermissionCheckContext
  ): Promise<boolean> {
    const permissionRule = this.permissions[role]

    if (!permissionRule) {
      return false
    }

    // Check deny rules first (deny takes precedence)
    if (permissionRule.deny) {
      for (const denyPattern of permissionRule.deny) {
        if (this.matchesPattern(denyPattern, context.entity, context.action)) {
          return false
        }
      }
    }

    // Check allow rules
    if (Array.isArray(permissionRule.allow)) {
      for (const allowRule of permissionRule.allow) {
        if (typeof allowRule === 'string') {
          // Simple string pattern (e.g., "Post.*", "*.read")
          if (this.matchesPattern(allowRule, context.entity, context.action)) {
            return true
          }
        } else {
          // PermissionCondition with entity, actions, and condition
          if (this.matchesCondition(allowRule, context)) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Check anonymous (no session) permissions
   */
  private checkAnonymousPermission(context: PermissionCheckContext): boolean {
    const anonymousRule = this.permissions['anonymous'] || this.permissions['public']

    if (!anonymousRule) {
      return false
    }

    // Check deny rules
    if (anonymousRule.deny) {
      for (const denyPattern of anonymousRule.deny) {
        if (this.matchesPattern(denyPattern, context.entity, context.action)) {
          return false
        }
      }
    }

    // Check allow rules
    if (Array.isArray(anonymousRule.allow)) {
      for (const allowRule of anonymousRule.allow) {
        if (typeof allowRule === 'string') {
          if (this.matchesPattern(allowRule, context.entity, context.action)) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Match permission pattern (e.g., "Post.*", "*.read", "*.*")
   */
  private matchesPattern(pattern: string, entity: string, action: string): boolean {
    const [entityPattern, actionPattern] = pattern.split('.')

    const entityMatches = entityPattern === '*' || entityPattern === entity
    const actionMatches = actionPattern === '*' || actionPattern === action

    return entityMatches && actionMatches
  }

  /**
   * Match permission condition
   */
  private matchesCondition(
    condition: PermissionCondition,
    context: PermissionCheckContext
  ): boolean {
    // Check if entity matches
    if (condition.entity !== '*' && condition.entity !== context.entity) {
      return false
    }

    // Check if action matches
    if (!condition.actions.includes('*') && !condition.actions.includes(context.action)) {
      return false
    }

    // Check access condition
    return this.evaluateAccessCondition(condition.condition, context)
  }

  /**
   * Evaluate access condition
   */
  private evaluateAccessCondition(
    condition: AccessCondition,
    context: PermissionCheckContext
  ): boolean {
    // Boolean condition
    if (typeof condition === 'boolean') {
      return condition
    }

    // String shorthand conditions
    if (typeof condition === 'string') {
      switch (condition) {
        case 'public':
          return true
        case 'authenticated':
          return !!context.session?.user
        case 'owner':
          if (!context.session?.user?.id || !context.data) return false
          return context.data.userId === context.session.user.id
        default:
          return false
      }
    }

    // AND condition
    if ('and' in condition && Array.isArray(condition.and)) {
      return condition.and.every(c => this.evaluateAccessCondition(c, context))
    }

    // OR condition
    if ('or' in condition && Array.isArray(condition.or)) {
      return condition.or.some(c => this.evaluateAccessCondition(c, context))
    }

    // Object condition - check field values
    if (typeof condition === 'object') {
      for (const [key, value] of Object.entries(condition)) {
        const actualValue = this.resolveValue(value, context.session)
        const dataValue = context.data?.[key]

        if (dataValue !== actualValue) {
          return false
        }
      }
      return true
    }

    return false
  }

  /**
   * Resolve value with session substitution
   */
  private resolveValue(value: any, session?: UserSession | null): any {
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
   * Get user roles from session
   */
  private getUserRoles(session: UserSession): string[] {
    // Check for roles in different possible locations
    const roles: string[] = []

    const user = session.user as any

    // From user.role (single role)
    if (user?.role && typeof user.role === 'string') {
      roles.push(user.role)
    }

    // From user.roles (array)
    if (user?.roles && Array.isArray(user.roles)) {
      roles.push(...user.roles)
    }

    // Default role if none specified
    if (roles.length === 0 && session.user) {
      roles.push('user') // Default authenticated user role
    }

    return roles
  }

  /**
   * Get all permissions for a role
   */
  getRolePermissions(role: string): PermissionRule | undefined {
    return this.permissions[role]
  }

  /**
   * Get all defined roles
   */
  getAllRoles(): string[] {
    return Object.keys(this.permissions)
  }
}
