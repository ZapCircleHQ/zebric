/**
 * AuthProvider Interface
 *
 * Defines the contract for authentication providers in the Zebric Engine.
 * This allows for pluggable authentication systems beyond Better Auth.
 */

import type { Blueprint } from '../types/blueprint.js'

/**
 * User session information returned by authentication providers
 */
export interface UserSession {
  id: string
  userId: string
  user: {
    id: string
    email: string
    name?: string
    [key: string]: any
  }
  expiresAt: Date
  createdAt: Date
  actor?: AuthenticatedActor
}

export interface AuthenticatedActor {
  type: 'user' | 'agent' | 'system'
  id: string
  displayName?: string
  credentialId?: string
  scopes?: string[]
  constraints?: Record<string, string[]>
}

/**
 * Identity used for background workflow execution (entity/webhook/schedule triggers),
 * which has no attributable HTTP caller. Distinct from an anonymous request: it's never
 * constructed from a request, only assigned internally by the workflow engine, so it
 * can't be forged over HTTP. Permission/access checks treat it as fully trusted.
 */
export const SYSTEM_SESSION: UserSession = {
  id: '__zebric_system__',
  userId: '__zebric_system__',
  user: {
    id: '__zebric_system__',
    email: 'system@zebric.internal',
    name: 'Zebric Workflow Engine',
  },
  expiresAt: new Date('9999-12-31T23:59:59.000Z'),
  createdAt: new Date(0),
  actor: {
    type: 'system',
    id: '__zebric_system__',
    displayName: 'Zebric Workflow Engine',
  },
}

export function isSystemSession(session: UserSession | null | undefined): boolean {
  return session?.user?.id === SYSTEM_SESSION.user.id
}

/**
 * Configuration required to initialize an authentication provider
 */
export interface AuthProviderConfig {
  databaseUrl: string
  blueprint: Blueprint
  baseURL: string
  secret: string
  trustedOrigins: string[]
}

/**
 * AuthProvider interface
 *
 * All authentication providers must implement this interface to be compatible
 * with the ZBL Engine runtime.
 */
export interface AuthProvider {
  /**
   * Get the underlying auth instance (provider-specific)
   * This allows access to provider-specific APIs when needed
   */
  getAuthInstance(): any

  /**
   * Get session from request (Web API Request)
   * Returns null if no valid session exists
   */
  getSession(request: Request): Promise<UserSession | null>

  /**
   * Check if a user has a specific role
   */
  hasRole(session: UserSession | null, role: string): boolean

  /**
   * Check if a user owns a resource
   */
  ownsResource(session: UserSession | null, resourceUserId: string): boolean

  /**
   * Cleanup/shutdown the auth provider
   */
  cleanup?(): Promise<void>
}

/**
 * Factory function type for creating auth providers
 */
export type AuthProviderFactory = (config: AuthProviderConfig) => AuthProvider
