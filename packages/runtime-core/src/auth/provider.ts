/**
 * AuthProvider Interface
 *
 * Defines the contract for authentication providers in the Zebric Engine.
 * This allows for pluggable authentication systems beyond Better Auth.
 */

import type { Blueprint } from '../types/blueprint.js'
import type { PluginAuthToken } from '../types/plugin.js'

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

export interface AuthPresentationConfig {
  signInMode: 'builtin' | 'redirect'
  signUpMode: 'builtin' | 'redirect' | 'disabled'
}

/**
 * AuthProvider interface
 *
 * All authentication providers must implement this interface to be compatible
 * with the ZBL Engine runtime.
 */
export interface AuthProvider {
  /**
   * Stable provider identifier used by the runtime.
   */
  getProviderId(): string

  /**
   * Get the underlying auth instance (provider-specific)
   * This allows access to provider-specific APIs when needed
   */
  getAuthInstance?(): any

  /**
   * Handle provider-owned auth routes mounted under /api/auth/*
   */
  handleAuthRequest(request: Request): Promise<Response>

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
   * Create a session token for plugin/runtime-issued sessions.
   */
  createSession(userId: string, options?: { replaceToken?: string }): Promise<PluginAuthToken>

  /**
   * Invalidate an existing session token.
   */
  invalidateSession(token: string): Promise<void>

  /**
   * Resolve a user payload from a session token.
   */
  resolveUserFromToken(token: string): Promise<Record<string, any> | null>

  /**
   * Describe how the public auth pages should behave for this provider.
   */
  getPresentationConfig(): AuthPresentationConfig

  /**
   * Compute the provider entry points used by /auth/sign-in and /auth/sign-up.
   */
  getSignInUrl(callbackURL: string): string
  getSignUpUrl(callbackURL: string): string | null

  /**
   * Cleanup/shutdown the auth provider
   */
  cleanup?(): Promise<void>
}

/**
 * Factory function type for creating auth providers
 */
export type AuthProviderFactory = (config: AuthProviderConfig) => AuthProvider
