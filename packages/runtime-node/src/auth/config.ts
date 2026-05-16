/**
 * Better Auth Configuration
 *
 * Configures Better Auth for the Zebric Engine.
 */

import { betterAuth, type Auth } from 'better-auth'
import Database from 'better-sqlite3'
import type { Blueprint, AuthConfig, AuthProvider, AuthProviderConfig } from '@zebric/runtime-core'
import { BetterAuthProvider } from './better-auth-provider.js'
import { GoogleWorkspaceAuthProvider } from './google-workspace-provider.js'

// Re-export for convenience
export type { AuthProviderConfig } from '@zebric/runtime-core'
export type AuthProviderId = 'better-auth' | 'google-workspace'

/**
 * Create Better Auth provider instance
 */
export function createBetterAuthProvider(config: AuthProviderConfig): AuthProvider {
  return new BetterAuthProvider(config)
}

export function createGoogleWorkspaceAuthProvider(config: AuthProviderConfig): AuthProvider {
  return new GoogleWorkspaceAuthProvider(config)
}

export function resolveAuthProviderId(auth?: AuthConfig): AuthProviderId {
  const explicit = auth?.provider?.trim()
  if (explicit === 'google-workspace') return 'google-workspace'
  if (explicit === 'better-auth') return 'better-auth'

  const providers = auth?.providers || []
  const normalized = providers.map(provider => provider.toLowerCase())
  if (
    normalized.length > 0 &&
    normalized.every(provider => provider === 'google' || provider === 'google-workspace')
  ) {
    return 'google-workspace'
  }

  return 'better-auth'
}

export function isAuthEnabled(blueprint: Blueprint): boolean {
  return Boolean(
    blueprint.auth?.provider
    || (blueprint.auth?.providers && blueprint.auth.providers.length > 0)
  )
}

export function usesManagedUserEntity(blueprint: Blueprint): boolean {
  return isAuthEnabled(blueprint)
}

export function createAuthProvider(config: AuthProviderConfig): AuthProvider {
  const providerId = resolveAuthProviderId(config.blueprint.auth)
  switch (providerId) {
    case 'google-workspace':
      return createGoogleWorkspaceAuthProvider(config)
    case 'better-auth':
    default:
      return createBetterAuthProvider(config)
  }
}

export interface BetterAuthConfig extends AuthProviderConfig {
  // Additional Better Auth specific config can go here if needed
}

/**
 * Create Better Auth instance configured for Zebric Engine
 */
export function createAuth(config: BetterAuthConfig): Auth<any> {
  const { databaseUrl, blueprint, baseURL, secret, trustedOrigins } = config

  // Get auth providers from Blueprint
  const providers = blueprint.auth?.providers || ['email']

  // Configure email/password authentication
  const emailPassword = providers.includes('email')

  // Create better-sqlite3 database instance
  const db = new Database(databaseUrl)

  return betterAuth({
    database: db,
    baseURL,
    secret,
    trustedOrigins,
    emailAndPassword: emailPassword
      ? {
          enabled: true,
        }
      : undefined,
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
    // Better Auth handles secure cookies automatically based on NODE_ENV
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  })
}

/**
 * Extract auth configuration from Blueprint
 */
export function getAuthConfigFromBlueprint(blueprint: Blueprint) {
  return {
    provider: resolveAuthProviderId(blueprint.auth),
    providers: blueprint.auth?.providers || ['email'],
  }
}
